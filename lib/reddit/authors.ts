import { detectRedditUi } from './detect';
import { normalizeUsername } from '../storage';

export type AuthorNode = {
  username: string;
  element: HTMLElement;
};

const PROCESSED_ATTR = 'data-rivet-author';

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

function collectOldRedditAuthors(root: ParentNode): AuthorNode[] {
  const results: AuthorNode[] = [];
  const seen = new Set<Element>();

  const nodes = root.querySelectorAll<HTMLElement>(
    'a.author, a[href*="/user/"], a[href*="/u/"]',
  );

  for (const el of nodes) {
    if (seen.has(el)) continue;
    seen.add(el);
    if (el.closest('.rivet-badge, .rivet-ignored-bar')) continue;
    if (el.hasAttribute(PROCESSED_ATTR) && el.getAttribute(PROCESSED_ATTR)) {
      // Still re-report so re-apply can refresh badges after tag edits
    }
    const username =
      usernameFromHref(el.getAttribute('href')) ||
      normalizeUsername(el.textContent || '');
    if (!username || username === '[deleted]') continue;
    el.setAttribute(PROCESSED_ATTR, username);
    results.push({ username, element: el });
  }

  return results;
}

function collectNewRedditAuthors(root: ParentNode): AuthorNode[] {
  const results: AuthorNode[] = [];
  const seen = new Set<Element>();

  const selectors = [
    'a[href*="/user/"]',
    'a[href*="/u/"]',
    'faceplate-tracker[noun="user_profile"] a',
    'shreddit-comment [slot="authorName"] a',
    'shreddit-post [slot="authorName"] a',
    '[data-testid="post_author_link"]',
    '[data-testid="comment_author_link"]',
  ].join(', ');

  const nodes = root.querySelectorAll<HTMLElement>(selectors);

  for (const el of nodes) {
    if (seen.has(el)) continue;
    seen.add(el);
    if (el.closest('.rivet-badge')) continue;

    const username =
      usernameFromHref(el.getAttribute('href')) ||
      normalizeUsername(el.textContent || '');
    if (!username || username === '[deleted]') continue;
    el.setAttribute(PROCESSED_ATTR, username);
    results.push({ username, element: el });
  }

  // Also walk open shadow roots lightly (faceplate / shreddit)
  const hosts = root.querySelectorAll<HTMLElement>('*');
  for (const host of hosts) {
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
  // unknown: try both
  return [...collectOldRedditAuthors(root), ...collectNewRedditAuthors(root)];
}
