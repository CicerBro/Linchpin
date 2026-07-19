import { isOldRedditListingPage } from './detect';

type ScrollState = {
  nextUrl: string | null;
  loading: boolean;
  stopped: boolean;
  seen: Set<string>;
  indicator: HTMLElement | null;
  observer: IntersectionObserver | null;
};

const state: ScrollState = {
  nextUrl: null,
  loading: false,
  stopped: false,
  seen: new Set(),
  indicator: null,
  observer: null,
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
  return (
    el.getAttribute('data-fullnamename') ||
    el.getAttribute('data-fullname') ||
    el.id ||
    null
  );
}

function ensureIndicator(): HTMLElement {
  if (state.indicator) return state.indicator;
  const el = document.createElement('div');
  el.id = 'rivet-ner-indicator';
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

function seedSeen(): void {
  const table = siteTable();
  if (!table) return;
  table.querySelectorAll('.thing').forEach((thing) => {
    const id = thingId(thing);
    if (id) state.seen.add(id);
  });
}

async function loadNextPage(onAppended: (nodes: Element[]) => void): Promise<void> {
  if (state.loading || state.stopped || !state.nextUrl) return;
  state.loading = true;
  setStatus('Loading more…');

  try {
    const res = await fetch(state.nextUrl, {
      credentials: 'include',
      headers: { Accept: 'text/html' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const remoteTable =
      doc.getElementById('siteTable') ||
      doc.querySelector('.sitetable.linklisting');
    if (!remoteTable) {
      state.stopped = true;
      setStatus('No more posts.');
      return;
    }

    const table = siteTable();
    if (!table) return;

    const appended: Element[] = [];
    remoteTable.querySelectorAll('.thing').forEach((thing) => {
      const id = thingId(thing);
      if (id && state.seen.has(id)) return;
      if (id) state.seen.add(id);
      // Skip clearleft / nav widgets that aren't posts
      if (thing.classList.contains('clearleft')) return;
      const clone = document.importNode(thing, true);
      // Insert before nav buttons if present at end of siteTable
      const nav = table.querySelector('.nav-buttons');
      if (nav) table.insertBefore(clone, nav);
      else table.appendChild(clone);
      appended.push(clone);
    });

    // Update next URL from fetched page; remove duplicate nav from appended flow
    state.nextUrl = findNextUrl(doc);
    const localNav = table.querySelector('.nav-buttons');
    if (localNav && state.nextUrl) {
      // Keep nav but we drive loading ourselves — hide next button noise
      localNav.querySelector('.next-button')?.remove();
    }

    if (appended.length) onAppended(appended);

    if (!state.nextUrl) {
      state.stopped = true;
      setStatus('End of listing.');
    } else {
      setStatus('');
    }
  } catch (err) {
    console.warn('[rivet] infinite scroll failed', err);
    setStatus('Failed to load more. Scroll again to retry.');
  } finally {
    state.loading = false;
  }
}

export function startOldRedditInfiniteScroll(
  onAppended: (nodes: Element[]) => void,
): () => void {
  if (!isOldRedditListingPage()) {
    return () => undefined;
  }

  seedSeen();
  state.nextUrl = findNextUrl();
  if (!state.nextUrl) {
    setStatus('');
    return () => undefined;
  }

  ensureIndicator();

  const sentinel = ensureIndicator();
  state.observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        void loadNextPage(onAppended);
      }
    },
    { rootMargin: '800px 0px' },
  );
  state.observer.observe(sentinel);

  return () => {
    state.observer?.disconnect();
    state.observer = null;
    state.indicator?.remove();
    state.indicator = null;
    state.loading = false;
    state.stopped = false;
    state.seen.clear();
    state.nextUrl = null;
  };
}
