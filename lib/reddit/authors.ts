import { detectRedditUi } from './detect';
import { normalizeUsername } from '../storage';

export type AuthorNode = {
  username: string;
  element: HTMLElement;
};

const PROCESSED_ATTR = 'data-linchpin-author';

/** Old Reddit chrome / nav that contains /user/ links but is not an author attribution. */
const OLD_SKIP_CLOSEST =
  '.tabmenu, .side, .footer-parent, .footer, #header-img-a, .dropdown.srdrop, .pref-lang, .flat-list.buttons, .userattrs';

const OLD_AUTHOR_SELECTORS =
  'a.author, .tagline a[href*="/user/"], .tagline a[href*="/u/"], .search-result-meta a[href*="/user/"]';

const NEW_AUTHOR_SELECTORS = [
  'faceplate-tracker[noun="user_profile"] a',
  'shreddit-comment [slot="authorName"] a',
  'shreddit-post [slot="authorName"] a',
  '[data-testid="post_author_link"]',
  '[data-testid="comment_author_link"]',
  'a[href*="/user/"]',
  'a[href*="/u/"]',
].join(', ');

function usernameFromHref(href: string | null | undefined): string | null {
  if (!href) return null;
  try {
    const url = new URL(href, location.origin);
    const match = url.pathname.match(/\/(?:user|u)\/([^/?#]+)/i);
    if (!match) return null;
    const name = decodeURIComponent(match[1]);
    if (!name || name === 'me' || name === '[deleted]') return null;
    return normalizeUsername(name);
  } catch {
    return null;
  }
}

/** Profile tab URLs like /user/foo/comments — not author bylines. */
function isProfileTabHref(href: string | null | undefined): boolean {
  if (!href) return false;
  try {
    const url = new URL(href, location.origin);
    return /\/(?:user|u)\/[^/]+\/(comments|submitted|gilded|upvoted|downvoted|hidden|saved|about|posts|overview)\/?/i.test(
      url.pathname,
    );
  } catch {
    return false;
  }
}

function linkTextLooksLikeUsername(el: HTMLElement, username: string): boolean {
  const text = normalizeUsername(el.textContent || '');
  if (!text) return false;
  // Tab labels etc.
  if (
    /^(overview|comments|submitted|gilded|upvoted|downvoted|hidden|saved|about|posts|view more)$/i.test(
      text,
    )
  ) {
    return false;
  }
  return text === username || text === `u/${username}`;
}

/**
 * querySelectorAll misses the root element itself. When `root` is an Element
 * that matches, include it; always include descendants.
 */
function queryAllIncludingRoot(
  root: ParentNode,
  selectors: string,
): HTMLElement[] {
  const out: HTMLElement[] = [];
  if (root instanceof Element && root.matches(selectors)) {
    out.push(root as HTMLElement);
  }
  if (root instanceof Document || root instanceof Element || root instanceof DocumentFragment) {
    out.push(...Array.from(root.querySelectorAll<HTMLElement>(selectors)));
  }
  return out;
}

const SHADOW_HOST_SELECTORS = [
  'shreddit-app',
  'shreddit-feed',
  'shreddit-post',
  'shreddit-comment',
  'shreddit-profile-comment',
  'faceplate-tracker',
  'reddit-header-large',
  '[slot="authorName"]',
].join(', ');

/** Only inspect Reddit components that can contain relevant author markup. */
function shadowHosts(root: ParentNode): Element[] {
  return queryAllIncludingRoot(root, SHADOW_HOST_SELECTORS);
}

function collectOldRedditAuthors(root: ParentNode): AuthorNode[] {
  const results: AuthorNode[] = [];
  const seen = new Set<Element>();

  for (const el of queryAllIncludingRoot(root, OLD_AUTHOR_SELECTORS)) {
    if (seen.has(el)) continue;
    seen.add(el);
    if (el.closest('.linchpin-badge, .linchpin-ignored-bar')) continue;
    if (el.closest(OLD_SKIP_CLOSEST)) continue;
    if (isProfileTabHref(el.getAttribute('href'))) continue;

    const username =
      usernameFromHref(el.getAttribute('href')) ||
      (el.classList.contains('author')
        ? normalizeUsername(el.textContent || '')
        : null);
    if (!username || username === '[deleted]') continue;

    // Non-.author href matches must look like the username (skip "comments" tabs etc.)
    if (!el.classList.contains('author') && !linkTextLooksLikeUsername(el, username)) {
      continue;
    }

    el.setAttribute(PROCESSED_ATTR, username);
    results.push({ username, element: el });
  }

  return results;
}

function collectNewRedditAuthors(root: ParentNode): AuthorNode[] {
  const results: AuthorNode[] = [];
  const seen = new Set<Element>();

  for (const el of queryAllIncludingRoot(root, NEW_AUTHOR_SELECTORS)) {
    if (seen.has(el)) continue;
    seen.add(el);
    if (el.closest('.linchpin-badge')) continue;
    if (isProfileTabHref(el.getAttribute('href'))) continue;

    // Skip header/nav chrome on new Reddit
    if (
      el.closest(
        'header, nav, [role="navigation"], #expand-user-drawer-button, shreddit-subreddit-header',
      )
    ) {
      // Allow author slots inside posts/comments even if nested oddly
      if (
        !el.closest(
          'shreddit-post, shreddit-comment, [data-testid="post-container"], faceplate-tracker[noun="user_profile"]',
        )
      ) {
        continue;
      }
    }

    const username =
      usernameFromHref(el.getAttribute('href')) ||
      normalizeUsername(el.textContent || '');
    if (!username || username === '[deleted]') continue;

    const inAuthorSlot = Boolean(
      el.closest(
        '[slot="authorName"], [data-testid="post_author_link"], [data-testid="comment_author_link"], faceplate-tracker[noun="user_profile"]',
      ),
    );
    if (!inAuthorSlot && !linkTextLooksLikeUsername(el, username)) continue;

    el.setAttribute(PROCESSED_ATTR, username);
    results.push({ username, element: el });
  }

  // Walk open shadow roots (include root.shadowRoot when root is an Element —
  // querySelectorAll('*') does not include the root host itself).
  for (const host of shadowHosts(root)) {
    const shadow = host.shadowRoot;
    if (!shadow) continue;
    results.push(...collectNewRedditAuthors(shadow));
  }

  return results;
}

export function findAuthorNodes(root: ParentNode = document): AuthorNode[] {
  const ui = detectRedditUi();
  if (ui === 'old') return collectOldRedditAuthors(root);
  if (ui === 'new') return collectNewRedditAuthors(root);
  return [...collectOldRedditAuthors(root), ...collectNewRedditAuthors(root)];
}
