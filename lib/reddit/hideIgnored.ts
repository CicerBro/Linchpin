import type { Settings, UserTagMap } from '../types';
import { isIgnoredTag, normalizeUsername } from '../storage';
import { findAuthorNodes } from './authors';
import { detectRedditUi } from './detect';

const HIDDEN_ATTR = 'data-linchpin-hidden';
const REVEALED_ATTR = 'data-linchpin-revealed';
const BAR_CLASS = 'linchpin-ignored-bar';

function findContainer(authorEl: HTMLElement): HTMLElement | null {
  const ui = detectRedditUi();

  if (ui === 'old') {
    return (
      authorEl.closest<HTMLElement>('.thing') || authorEl.closest<HTMLElement>('.Comment') || null
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
  if (document.getElementById('linchpin-hide-styles')) return;
  const style = document.createElement('style');
  style.id = 'linchpin-hide-styles';
  style.textContent = `
    .linchpin-ignored-collapsed > :not(.${BAR_CLASS}) {
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

function unhideContainer(container: Element): void {
  container.classList.remove('linchpin-ignored-collapsed');
  container.removeAttribute(HIDDEN_ATTR);
  container.removeAttribute(REVEALED_ATTR);
  container.querySelector(`.${BAR_CLASS}`)?.remove();
}

function makeBar(username: string, container: HTMLElement): HTMLElement {
  const bar = document.createElement('div');
  bar.className = BAR_CLASS;
  const message = document.createElement('span');
  message.append('Ignored user ');
  const strong = document.createElement('strong');
  strong.textContent = `u/${username}`;
  message.appendChild(strong);
  bar.appendChild(message);
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = 'Show anyway';
  btn.addEventListener('click', () => {
    container.classList.remove('linchpin-ignored-collapsed');
    // Keep username on HIDDEN_ATTR so undo-ignore can still clear this container
    container.setAttribute(REVEALED_ATTR, '1');
    bar.remove();
  });
  bar.appendChild(btn);
  return bar;
}

/** Clear collapse/bar for containers whose user is no longer ignored. */
function clearStaleHides(tags: UserTagMap, root: ParentNode): void {
  const hidden = Array.from(root.querySelectorAll?.(`[${HIDDEN_ATTR}]`) ?? []);
  if (root instanceof Element && root.hasAttribute(HIDDEN_ATTR)) hidden.unshift(root);
  hidden.forEach((el) => {
    const username = normalizeUsername(el.getAttribute(HIDDEN_ATTR) || '');
    // Legacy: older builds stored "revealed" in HIDDEN_ATTR
    if (!username || username === 'revealed' || !isIgnoredTag(tags[username])) {
      unhideContainer(el);
    }
  });
}

export function applyIgnoreHides(
  tags: UserTagMap,
  settings: Settings,
  root: ParentNode = document,
): void {
  ensureRevealStyles();

  if (!settings.reddit.ignore) {
    document.querySelectorAll(`[${HIDDEN_ATTR}]`).forEach(unhideContainer);
    return;
  }

  clearStaleHides(tags, root);

  for (const { username, element: authorEl } of findAuthorNodes(root)) {
    const tag = tags[username];
    if (!isIgnoredTag(tag)) continue;

    const container = findContainer(authorEl);
    if (!container) continue;
    if (container.hasAttribute(REVEALED_ATTR)) continue;
    // Legacy revealed marker
    if (container.getAttribute(HIDDEN_ATTR) === 'revealed') continue;
    if (container.classList.contains('linchpin-ignored-collapsed')) continue;

    container.classList.add('linchpin-ignored-collapsed');
    container.setAttribute(HIDDEN_ATTR, username);
    if (!container.querySelector(`.${BAR_CLASS}`)) {
      container.insertBefore(makeBar(username, container), container.firstChild);
    }
  }
}
