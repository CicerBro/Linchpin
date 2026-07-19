import {
  getSubredditVisits,
  normalizeSubreddit,
  recordSubredditVisit,
} from '../storage';
import type { Settings, SubredditVisitMap } from '../types';
import { detectRedditUi } from './detect';

const HINT_ID = 'rivet-subreddit-last-visited';

function formatRelative(ts: number, now = Date.now()): string {
  const sec = Math.max(0, Math.floor((now - ts) / 1000));
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 48) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  if (days < 60) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

/** Extract subreddit name from current URL, or null if not on a subreddit. */
export function currentSubredditFromLocation(): string | null {
  const m = location.pathname.match(/^\/r\/([^/?#]+)/i);
  if (!m) return null;
  const name = normalizeSubreddit(m[1]);
  if (!name || name === 'all' || name === 'popular' || name === 'friends') {
    return null;
  }
  return name;
}

function ensureStyles(): void {
  if (document.getElementById('rivet-subvisit-styles')) return;
  const style = document.createElement('style');
  style.id = 'rivet-subvisit-styles';
  style.textContent = `
    #${HINT_ID} {
      font: 12px/1.4 system-ui, -apple-system, sans-serif;
      color: #666;
      margin: 4px 0 8px;
      padding: 4px 0;
    }
    .rivet-sub-visit-badge {
      font: 600 10px/1 system-ui, -apple-system, sans-serif;
      color: #555;
      margin-left: 6px;
      white-space: nowrap;
    }
  `;
  document.documentElement.appendChild(style);
}

function upsertHeaderHint(text: string): void {
  ensureStyles();
  let el = document.getElementById(HINT_ID);
  if (!el) {
    el = document.createElement('div');
    el.id = HINT_ID;

    const ui = detectRedditUi();
    if (ui === 'old') {
      const header =
        document.getElementById('header-bottom-left') ||
        document.querySelector('.side .titlebox') ||
        document.querySelector('#siteTable');
      if (header?.parentElement && header.id === 'header-bottom-left') {
        header.insertAdjacentElement('afterend', el);
      } else if (header) {
        header.insertAdjacentElement('afterbegin', el);
      } else {
        document.body.prepend(el);
      }
    } else {
      const anchor =
        document.querySelector('shreddit-subreddit-header-buttons') ||
        document.querySelector('h1') ||
        document.querySelector('shreddit-app');
      if (anchor) anchor.insertAdjacentElement('beforebegin', el);
      else document.body.prepend(el);
    }
  }
  el.textContent = text;
}

/**
 * Annotate subreddit links in listings with last-visited age when known.
 */
function annotateSubredditLinks(visits: SubredditVisitMap): void {
  ensureStyles();
  const links = document.querySelectorAll<HTMLAnchorElement>(
    'a.subreddit, a[href*="/r/"], faceplate-tracker[noun="subreddit"] a',
  );

  for (const a of links) {
    const href = a.getAttribute('href') || '';
    const m = href.match(/\/r\/([^/?#]+)/i);
    if (!m) continue;
    const name = normalizeSubreddit(m[1]);
    const ts = visits[name];
    if (!ts) continue;

    const parent = a.parentElement;
    if (!parent) continue;
    if (parent.querySelector(`.rivet-sub-visit-badge[data-sub="${name}"]`)) {
      continue;
    }
    // Skip if this is the main header subreddit title (header hint covers it)
    if (a.closest('#header-bottom-left, shreddit-subreddit-header')) continue;

    const badge = document.createElement('span');
    badge.className = 'rivet-sub-visit-badge';
    badge.dataset.sub = name;
    badge.title = `Last visited ${new Date(ts).toLocaleString()}`;
    badge.textContent = `· visited ${formatRelative(ts)}`;
    a.insertAdjacentElement('afterend', badge);
  }
}

/**
 * Show last-visited hint for the current subreddit and stamp this visit
 * after a short delay so "last visit" means the previous session.
 */
export function startSubredditLastVisited(settings: Settings): () => void {
  if (!settings.enableSubredditLastVisited) {
    document.getElementById(HINT_ID)?.remove();
    return () => undefined;
  }

  const sub = currentSubredditFromLocation();
  let cancelled = false;
  let timer: number | undefined;

  void (async () => {
    const visits = await getSubredditVisits();
    if (cancelled) return;

    if (sub) {
      const prev = visits[sub];
      if (prev) {
        upsertHeaderHint(
          `Last visited r/${sub}: ${formatRelative(prev)} (${new Date(prev).toLocaleString()})`,
        );
      } else {
        upsertHeaderHint(`First Rivet visit to r/${sub}`);
      }

      // Record visit after user has been here briefly (previous stamp stays visible)
      timer = window.setTimeout(() => {
        if (!cancelled) void recordSubredditVisit(sub);
      }, 4000);
    }

    annotateSubredditLinks(visits);
  })();

  return () => {
    cancelled = true;
    if (timer) window.clearTimeout(timer);
  };
}

export function refreshSubredditVisitBadges(
  visits: SubredditVisitMap,
  settings: Settings,
): void {
  if (!settings.enableSubredditLastVisited) {
    document.getElementById(HINT_ID)?.remove();
    document.querySelectorAll('.rivet-sub-visit-badge').forEach((el) => el.remove());
    return;
  }
  annotateSubredditLinks(visits);
}
