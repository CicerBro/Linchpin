import type { Settings, UserTagMap } from '../types';
import { isIgnoredTag, normalizeUsername } from '../storage';
import { detectRedditUi } from './detect';

const HIDDEN_ATTR = 'data-rivet-hidden';
const BAR_CLASS = 'rivet-ignored-bar';

function findContainer(authorEl: HTMLElement): HTMLElement | null {
  const ui = detectRedditUi();

  if (ui === 'old') {
    return (
      authorEl.closest<HTMLElement>('.thing') ||
      authorEl.closest<HTMLElement>('.Comment') ||
      null
    );
  }

  return (
    authorEl.closest<HTMLElement>(
      'shreddit-post, shreddit-comment, article, [data-testid="post-container"]',
    ) ||
    authorEl.closest<HTMLElement>('[id^="t1_"], [id^="t3_"]') ||
    null
  );
}

function ensureRevealStyles(): void {
  if (document.getElementById('rivet-hide-styles')) return;
  const style = document.createElement('style');
  style.id = 'rivet-hide-styles';
  style.textContent = `
    .rivet-ignored-collapsed > :not(.${BAR_CLASS}) {
      display: none !important;
    }
    .${BAR_CLASS} {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 10px;
      margin: 4px 0;
      font: 12px/1.3 system-ui, -apple-system, sans-serif;
      color: #555;
      background: #f0f0f0;
      border: 1px dashed #bbb;
      border-radius: 4px;
    }
    .${BAR_CLASS} button {
      font: inherit;
      cursor: pointer;
      padding: 2px 8px;
      border: 1px solid #999;
      border-radius: 3px;
      background: #fff;
    }
  `;
  document.documentElement.appendChild(style);
}

function makeBar(username: string, container: HTMLElement): HTMLElement {
  const bar = document.createElement('div');
  bar.className = BAR_CLASS;
  bar.innerHTML = `<span>Ignored user <strong>u/${username}</strong></span>`;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = 'Show anyway';
  btn.addEventListener('click', () => {
    container.classList.remove('rivet-ignored-collapsed');
    container.setAttribute(HIDDEN_ATTR, 'revealed');
    bar.remove();
  });
  bar.appendChild(btn);
  return bar;
}

export function applyIgnoreHides(
  tags: UserTagMap,
  settings: Settings,
  root: ParentNode = document,
): void {
  ensureRevealStyles();

  if (!settings.enableIgnore) {
    document.querySelectorAll(`[${HIDDEN_ATTR}]`).forEach((el) => {
      el.classList.remove('rivet-ignored-collapsed');
      el.removeAttribute(HIDDEN_ATTR);
      el.querySelector(`.${BAR_CLASS}`)?.remove();
    });
    return;
  }

  const authorLinks = (root instanceof Element || root === document
    ? (root as Document | Element).querySelectorAll<HTMLElement>(
        'a.author, a[href*="/user/"], a[href*="/u/"], [data-testid="post_author_link"], [data-testid="comment_author_link"]',
      )
    : []) as NodeListOf<HTMLElement> | HTMLElement[];

  const list =
    authorLinks instanceof NodeList
      ? Array.from(authorLinks)
      : Array.from(authorLinks);

  for (const authorEl of list) {
    const href = authorEl.getAttribute('href') || '';
    const match = href.match(/\/(?:user|u)\/([^/?#]+)/i);
    const username = normalizeUsername(
      match ? decodeURIComponent(match[1]) : authorEl.textContent || '',
    );
    if (!username) continue;
    const tag = tags[username];
    if (!isIgnoredTag(tag)) continue;

    const container = findContainer(authorEl);
    if (!container) continue;
    if (container.getAttribute(HIDDEN_ATTR) === 'revealed') continue;
    if (container.classList.contains('rivet-ignored-collapsed')) continue;

    container.classList.add('rivet-ignored-collapsed');
    container.setAttribute(HIDDEN_ATTR, username);
    if (!container.querySelector(`.${BAR_CLASS}`)) {
      container.insertBefore(makeBar(username, container), container.firstChild);
    }
  }
}
