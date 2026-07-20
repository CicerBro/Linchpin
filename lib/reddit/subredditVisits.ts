import { getSubredditVisits, normalizeSubreddit, recordSubredditVisit } from '../storage';
import type { Settings, SubredditVisitMap } from '../types';
import { detectRedditUi } from './detect';

const HINT_ID = 'linchpin-subreddit-last-visited';
const BADGE_CLASS = 'linchpin-sub-visit-badge';
const LINK_MARK = 'data-linchpin-sub-visit';

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

/** Per-link visit badges are too noisy on new-Reddit profile feeds. */
function allowLinkBadgesOnThisPage(): boolean {
  if (detectRedditUi() !== 'new') return true;
  return !/^\/(?:user|u)\//i.test(location.pathname);
}

function ensureStyles(): void {
  if (document.getElementById('linchpin-subvisit-styles')) return;
  const style = document.createElement('style');
  style.id = 'linchpin-subvisit-styles';
  style.textContent = `
    #${HINT_ID} {
      font: 12px/1.4 system-ui, -apple-system, sans-serif;
      color: #666;
      margin: 4px 0 8px;
      padding: 4px 0;
    }
    /* Old Reddit: sit in the tab row instead of a new header line */
    #header-bottom-left .tabmenu > #${HINT_ID} {
      display: inline;
      list-style: none;
      margin: 0 0 0 8px;
      padding: 0;
      font: 11px/18px verdana, arial, helvetica, sans-serif;
      color: #888;
      white-space: nowrap;
      vertical-align: bottom;
    }
    .${BADGE_CLASS} {
      font: 600 10px/1.2 system-ui, -apple-system, sans-serif;
      color: #555;
      margin-left: 4px;
      white-space: nowrap;
      display: inline;
      flex: 0 0 auto;
    }
  `;
  document.documentElement.appendChild(style);
}

function clearLinkBadges(): void {
  document.querySelectorAll(`.${BADGE_CLASS}`).forEach((el) => el.remove());
  document.querySelectorAll(`[${LINK_MARK}]`).forEach((el) => {
    el.removeAttribute(LINK_MARK);
  });
}

function upsertHeaderHint(text: string): void {
  ensureStyles();
  let el = document.getElementById(HINT_ID);
  const ui = detectRedditUi();

  if (ui === 'old') {
    const tabmenu = document.querySelector('#header-bottom-left .tabmenu');
    // Prefer an <li> inside .tabmenu (after "other discussions" / last tab)
    if (tabmenu) {
      if (!el || el.tagName !== 'LI' || el.parentElement !== tabmenu) {
        el?.remove();
        el = document.createElement('li');
        el.id = HINT_ID;
        tabmenu.appendChild(el);
      }
      el.textContent = text;
      return;
    }

    if (!el || el.tagName === 'LI') {
      el?.remove();
      el = document.createElement('div');
      el.id = HINT_ID;
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
    }
    el.textContent = text;
    return;
  }

  if (!el || el.tagName === 'LI') {
    el?.remove();
    el = document.createElement('div');
    el.id = HINT_ID;
    const anchor =
      document.querySelector('shreddit-subreddit-header-buttons') ||
      document.querySelector('shreddit-subreddit-header') ||
      document.querySelector('shreddit-app');
    if (anchor) anchor.insertAdjacentElement('beforebegin', el);
    else document.body.prepend(el);
  }
  el.textContent = text;
}

function cardForLink(a: Element): Element | null {
  return a.closest(
    [
      'shreddit-post',
      'shreddit-comment',
      'shreddit-profile-comment',
      'article',
      '.thing',
      '[data-testid="post-container"]',
      'faceplate-tracker[noun="post"]',
    ].join(', '),
  );
}

function isAnnotatableSubLink(a: HTMLAnchorElement, name: string): boolean {
  if (
    a.closest(
      [
        '#header-bottom-left',
        'shreddit-subreddit-header',
        'header',
        'nav',
        '[role="navigation"]',
        'aside',
        '#right-sidebar-container',
        '[id*="sidebar" i]',
        '[data-testid="frontpage-sidebar"]',
        'recent-posts',
      ].join(', '),
    )
  ) {
    return false;
  }

  // Icon-only / empty links break new Reddit flex rows if we inject after them
  const text = (a.textContent || '').replace(/\s+/g, ' ').trim();
  if (!text) return false;

  const looksLikeSubName =
    a.classList.contains('subreddit') ||
    new RegExp(`^(r/)?${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i').test(text) ||
    /^r\/[A-Za-z0-9_]+$/i.test(text);

  if (!looksLikeSubName) return false;

  // One badge per post/comment card for this sub
  const card = cardForLink(a);
  if (card?.querySelector(`.${BADGE_CLASS}[data-sub="${name}"]`)) {
    return false;
  }

  return true;
}

/**
 * Annotate subreddit name links with last-visited age (not icons, not profile spam).
 */
function annotateSubredditLinks(visits: SubredditVisitMap, root: ParentNode = document): void {
  if (!allowLinkBadgesOnThisPage()) {
    clearLinkBadges();
    return;
  }

  ensureStyles();
  const selector = 'a.subreddit, a[href*="/r/"]';
  const links = Array.from(root.querySelectorAll?.<HTMLAnchorElement>(selector) ?? []);
  if (root instanceof HTMLAnchorElement && root.matches(selector)) links.unshift(root);

  for (const a of links) {
    const href = a.getAttribute('href') || '';
    const m = href.match(/\/r\/([^/?#]+)/i);
    if (!m) continue;
    const name = normalizeSubreddit(m[1]);
    const ts = visits[name];
    if (!ts) continue;
    const signature = `${name}:${ts}`;
    const adjacent = a.nextElementSibling;
    if (a.getAttribute(LINK_MARK) === signature && adjacent?.classList.contains(BADGE_CLASS)) {
      continue;
    }
    if (a.hasAttribute(LINK_MARK)) {
      if (adjacent?.classList.contains(BADGE_CLASS)) adjacent.remove();
      a.removeAttribute(LINK_MARK);
    }
    if (!isAnnotatableSubLink(a, name)) continue;

    a.setAttribute(LINK_MARK, signature);
    const badge = document.createElement('span');
    badge.className = BADGE_CLASS;
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
  if (!settings.reddit.subredditVisits) {
    document.getElementById(HINT_ID)?.remove();
    clearLinkBadges();
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
        upsertHeaderHint(`First Linchpin visit to r/${sub}`);
      }

      timer = window.setTimeout(() => {
        if (!cancelled) void recordSubredditVisit(sub);
      }, 4000);
    } else {
      document.getElementById(HINT_ID)?.remove();
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
  root: ParentNode = document,
): void {
  if (!settings.reddit.subredditVisits) {
    document.getElementById(HINT_ID)?.remove();
    clearLinkBadges();
    return;
  }
  annotateSubredditLinks(visits, root);
}
