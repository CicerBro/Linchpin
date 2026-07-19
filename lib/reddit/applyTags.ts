import type { Settings, UserTag, UserTagMap } from '../types';
import { isIgnoredTag } from '../storage';
import { findAuthorNodes } from './authors';

const BADGE_ATTR = 'data-rivet-badge';

function contrastText(bg: string): string {
  const hex = bg.trim();
  const m = hex.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return '#fff';
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? '#111' : '#fff';
}

function badgeLabel(tag: UserTag): string {
  if (tag.label?.trim()) return tag.label.trim();
  if (isIgnoredTag(tag)) return 'ignore';
  const parts: string[] = [];
  if (typeof tag.votesUp === 'number' && tag.votesUp !== 0) {
    parts.push(`+${tag.votesUp}`);
  }
  if (typeof tag.votesDown === 'number' && tag.votesDown !== 0) {
    parts.push(`-${Math.abs(tag.votesDown)}`);
  }
  return parts.join(' ') || 'tagged';
}

function shouldShowBadge(tag: UserTag | undefined): tag is UserTag {
  if (!tag) return false;
  return Boolean(tag.label || tag.ignore || tag.color || tag.link);
}

function createBadge(tag: UserTag, style: Settings['tagBadgeStyle']): HTMLElement {
  const host = document.createElement('span');
  host.className = 'rivet-badge';
  host.setAttribute(BADGE_ATTR, tag.username);
  host.style.display = 'inline-flex';
  host.style.alignItems = 'center';
  host.style.marginLeft = '4px';
  host.style.verticalAlign = 'middle';

  const shadow = host.attachShadow({ mode: 'open' });
  const label = badgeLabel(tag);
  const bg = tag.color || (isIgnoredTag(tag) ? '#666' : '#455a64');
  const fg = contrastText(bg);

  const styleEl = document.createElement('style');
  styleEl.textContent =
    style === 'text'
      ? `
        :host { all: initial; }
        .badge {
          font: 600 11px/1.2 system-ui, -apple-system, sans-serif;
          color: ${bg};
          margin-left: 2px;
          white-space: nowrap;
        }
        a { color: inherit; text-decoration: underline; }
      `
      : `
        :host { all: initial; }
        .badge {
          display: inline-flex;
          align-items: center;
          font: 600 10px/1 system-ui, -apple-system, sans-serif;
          padding: 2px 6px;
          border-radius: 999px;
          background: ${bg};
          color: ${fg};
          white-space: nowrap;
          letter-spacing: 0.01em;
        }
        a { color: inherit; text-decoration: none; }
      `;

  const badge = document.createElement('span');
  badge.className = 'badge';
  badge.title = [
    `u/${tag.username}`,
    tag.label ? `label: ${tag.label}` : null,
    isIgnoredTag(tag) ? 'ignored' : null,
    tag.link || null,
  ]
    .filter(Boolean)
    .join('\n');

  if (tag.link) {
    const a = document.createElement('a');
    a.href = tag.link;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = label;
    badge.appendChild(a);
  } else {
    badge.textContent = label;
  }

  shadow.append(styleEl, badge);
  return host;
}

function removeExistingBadge(authorEl: HTMLElement): void {
  const next = authorEl.nextElementSibling;
  if (next?.classList.contains('rivet-badge')) {
    next.remove();
  }
  authorEl.parentElement
    ?.querySelectorAll(`.rivet-badge[${BADGE_ATTR}]`)
    .forEach((el) => {
      if (el.previousElementSibling === authorEl) el.remove();
    });
}

export function applyTagsToDocument(
  tags: UserTagMap,
  settings: Settings,
  root: ParentNode = document,
): void {
  if (!settings.enableTags) {
    root.querySelectorAll?.('.rivet-badge')?.forEach((el) => el.remove());
    return;
  }

  const authors = findAuthorNodes(root);
  for (const { username, element } of authors) {
    const tag = tags[username];
    removeExistingBadge(element);
    if (!shouldShowBadge(tag)) continue;
    const badge = createBadge(tag, settings.tagBadgeStyle);
    element.insertAdjacentElement('afterend', badge);
  }
}
