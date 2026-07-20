import { isOldRedditListingPage } from './detect';

type ScrollState = {
  nextUrl: string | null;
  loading: boolean;
  stopped: boolean;
  /** Bumped on stop/restart so in-flight fetches ignore stale completions. */
  generation: number;
  seen: Set<string>;
  indicator: HTMLElement | null;
  observer: IntersectionObserver | null;
  fetchedPages: number;
  appendedPosts: number;
  abort: AbortController | null;
};

const MAX_FETCHED_PAGES = 20;
const MAX_APPENDED_POSTS = 500;

const state: ScrollState = {
  nextUrl: null,
  loading: false,
  stopped: false,
  generation: 0,
  seen: new Set(),
  indicator: null,
  observer: null,
  fetchedPages: 0,
  appendedPosts: 0,
  abort: null,
};

function siteTable(): HTMLElement | null {
  return (
    document.getElementById('siteTable') ||
    document.querySelector<HTMLElement>('.sitetable.linklisting')
  );
}

function findNextUrl(doc: Document = document): string | null {
  const a =
    doc.querySelector<HTMLAnchorElement>('.next-button a') ||
    doc.querySelector<HTMLAnchorElement>('span.next-button a');
  return a?.href || null;
}

function thingId(el: Element): string | null {
  // Reddit uses data-fullname (e.g. t3_abc); keep legacy typo attr as fallback
  return el.getAttribute('data-fullname') || el.getAttribute('data-fullnamename') || el.id || null;
}

/** True when the load sentinel is still near/in the viewport. */
function sentinelStillNear(): boolean {
  const el = state.indicator;
  if (!el) return false;
  const rect = el.getBoundingClientRect();
  return rect.top < window.innerHeight + 800;
}

function ensureIndicator(): HTMLElement {
  if (state.indicator) return state.indicator;
  const el = document.createElement('div');
  el.id = 'linchpin-ner-indicator';
  el.style.cssText =
    'padding:10px;text-align:center;font:12px/1.4 system-ui,sans-serif;color:#666;';
  el.textContent = '';
  const table = siteTable();
  table?.parentElement?.appendChild(el);
  state.indicator = el;
  return el;
}

function setStatus(text: string): void {
  ensureIndicator().textContent = text;
}

function showContinueLink(): void {
  state.stopped = true;
  state.observer?.disconnect();
  const indicator = ensureIndicator();
  indicator.replaceChildren();
  if (!state.nextUrl) {
    indicator.textContent = 'End of listing.';
    return;
  }
  const link = document.createElement('a');
  link.href = state.nextUrl;
  link.textContent = 'Continue on the next Reddit page';
  link.rel = 'next';
  indicator.appendChild(link);
}

function seedSeen(): void {
  const table = siteTable();
  if (!table) return;
  table.querySelectorAll('.thing').forEach((thing) => {
    const id = thingId(thing);
    if (id) state.seen.add(id);
  });
}

async function loadNextPage(
  onAppended: (nodes: Element[]) => void,
  generation: number,
): Promise<void> {
  if (state.loading || state.stopped || !state.nextUrl) return;
  if (generation !== state.generation) return;
  if (state.fetchedPages >= MAX_FETCHED_PAGES || state.appendedPosts >= MAX_APPENDED_POSTS) {
    showContinueLink();
    return;
  }
  state.loading = true;
  setStatus('Loading more…');
  const abort = new AbortController();
  state.abort = abort;

  try {
    const res = await fetch(state.nextUrl, {
      credentials: 'include',
      headers: { Accept: 'text/html' },
      signal: abort.signal,
    });
    if (generation !== state.generation) return;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.fetchedPages++;
    const html = await res.text();
    if (generation !== state.generation) return;
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const remoteTable =
      doc.getElementById('siteTable') || doc.querySelector('.sitetable.linklisting');
    if (!remoteTable) {
      state.stopped = true;
      setStatus('No more posts.');
      return;
    }

    const table = siteTable();
    if (!table) return;

    const appended: Element[] = [];
    for (const thing of remoteTable.querySelectorAll('.thing')) {
      if (state.appendedPosts >= MAX_APPENDED_POSTS) break;
      const id = thingId(thing);
      if (id && state.seen.has(id)) continue;
      if (id) state.seen.add(id);
      // Skip clearleft / nav widgets that aren't posts
      if (thing.classList.contains('clearleft')) continue;
      const clone = document.importNode(thing, true);
      // Insert before nav buttons if present at end of siteTable
      const nav = table.querySelector('.nav-buttons');
      if (nav) table.insertBefore(clone, nav);
      else table.appendChild(clone);
      appended.push(clone);
      state.appendedPosts++;
    }

    // Update next URL from fetched page; remove duplicate nav from appended flow
    state.nextUrl = findNextUrl(doc);
    const localNav = table.querySelector('.nav-buttons');
    if (localNav && state.nextUrl) {
      // Keep nav but we drive loading ourselves — hide next button noise
      localNav.querySelector('.next-button')?.remove();
    }

    if (appended.length) onAppended(appended);
    appended.length = 0;

    if (!state.nextUrl) {
      state.stopped = true;
      setStatus('End of listing.');
    } else if (
      state.fetchedPages >= MAX_FETCHED_PAGES ||
      state.appendedPosts >= MAX_APPENDED_POSTS
    ) {
      showContinueLink();
    } else {
      setStatus('');
    }
  } catch (err) {
    if (generation !== state.generation) return;
    if (abort.signal.aborted) return;
    console.warn('[linchpin] infinite scroll failed', err);
    setStatus('Failed to load more. Scroll again to retry.');
  } finally {
    if (generation !== state.generation) return;
    if (state.abort === abort) state.abort = null;
    state.loading = false;
    // IntersectionObserver may not re-fire if the sentinel never left the
    // viewport after a short page — chain another load while still near.
    // Defer one frame so we don't race a simultaneous observer callback.
    if (!state.stopped && state.nextUrl && sentinelStillNear()) {
      requestAnimationFrame(() => {
        if (
          generation === state.generation &&
          !state.loading &&
          !state.stopped &&
          state.nextUrl &&
          sentinelStillNear()
        ) {
          void loadNextPage(onAppended, generation);
        }
      });
    }
  }
}

export function startOldRedditInfiniteScroll(onAppended: (nodes: Element[]) => void): () => void {
  if (!isOldRedditListingPage()) {
    return () => undefined;
  }

  // Fresh run — clear any leftover module state from a prior listing
  state.observer?.disconnect();
  state.observer = null;
  state.indicator?.remove();
  state.indicator = null;
  state.loading = false;
  state.stopped = false;
  state.abort?.abort();
  state.abort = null;
  state.fetchedPages = 0;
  state.appendedPosts = 0;
  state.generation += 1;
  const generation = state.generation;
  state.seen.clear();
  state.nextUrl = null;

  seedSeen();
  state.nextUrl = findNextUrl();
  if (!state.nextUrl) {
    return () => undefined;
  }

  const sentinel = ensureIndicator();
  state.observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        void loadNextPage(onAppended, generation);
      }
    },
    { rootMargin: '800px 0px' },
  );
  state.observer.observe(sentinel);

  return () => {
    state.generation += 1;
    state.observer?.disconnect();
    state.observer = null;
    state.indicator?.remove();
    state.indicator = null;
    state.loading = false;
    state.stopped = false;
    state.abort?.abort();
    state.abort = null;
    state.fetchedPages = 0;
    state.appendedPosts = 0;
    state.seen.clear();
    state.nextUrl = null;
  };
}
