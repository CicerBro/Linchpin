import type { Settings, UserTag, UserTagMap } from '../types';
import { isIgnoredTag } from '../storage';
import { findAuthorNodes } from './authors';
import { formatNetVote, netVoteScore, voteBadgeColors } from './votes';

const BADGE_ATTR = 'data-linchpin-badge';

/** Resolve any CSS color (hex, rgb, named) to sRGB channels via canvas. */
function resolveCssColor(input: string): { r: number; g: number; b: number } | null {
  const s = input.trim();
  if (!s) return null;

  const hex = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    let h = hex[1];
    if (h.length === 3)
      h = h
        .split('')
        .map((c) => c + c)
        .join('');
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
    };
  }

  try {
    const ctx = document.createElement('canvas').getContext('2d');
    if (!ctx) return null;
    // Sentinel: invalid colors leave fillStyle unchanged
    ctx.fillStyle = '#01fe02';
    const sentinel = String(ctx.fillStyle);
    ctx.fillStyle = s;
    const normalized = String(ctx.fillStyle);
    if (normalized === sentinel) return null;

    const asHex = normalized.match(/^#([0-9a-f]{6})$/i);
    if (asHex) {
      const h = asHex[1];
      return {
        r: parseInt(h.slice(0, 2), 16),
        g: parseInt(h.slice(2, 4), 16),
        b: parseInt(h.slice(4, 6), 16),
      };
    }
    const rgb = normalized.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
    if (rgb) {
      return { r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]) };
    }
  } catch {
    /* ignore */
  }
  return null;
}

function contrastText(bg: string): string {
  const rgb = resolveCssColor(bg);
  if (!rgb) return '#fff';
  const lum = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
  return lum > 0.6 ? '#111' : '#fff';
}

function safeCssColor(value: string | undefined): string | undefined {
  if (!value || value.length > 100 || /[<>"'`;{}]/.test(value)) return undefined;
  return CSS.supports('color', value) ? value : undefined;
}

function safeHttpLink(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function isVoteStyleTag(tag: UserTag): boolean {
  // Custom label/color wins; otherwise net-vote display gets green/red even if a link exists
  if (tag.label?.trim() || tag.color || isIgnoredTag(tag)) return false;
  return netVoteScore(tag) != null;
}

function badgeLabel(tag: UserTag): string {
  if (tag.label?.trim()) return tag.label.trim();
  if (isIgnoredTag(tag)) return 'ignore';
  const score = netVoteScore(tag);
  if (score != null) return formatNetVote(score);
  return 'tagged';
}

function shouldShowBadge(tag: UserTag | undefined): tag is UserTag {
  if (!tag) return false;
  return Boolean(tag.label || tag.ignore || tag.color || tag.link || netVoteScore(tag) != null);
}

function createBadge(tag: UserTag, style: Settings['reddit']['tagBadgeStyle']): HTMLElement {
  const host = document.createElement('span');
  host.className = 'linchpin-badge';
  host.setAttribute(BADGE_ATTR, tag.username);
  host.style.display = 'inline-flex';
  host.style.alignItems = 'center';
  host.style.marginLeft = '4px';
  host.style.marginRight = '4px';
  host.style.verticalAlign = 'middle';

  const shadow = host.attachShadow({ mode: 'open' });
  const label = badgeLabel(tag);
  const score = netVoteScore(tag);
  const voteStyle = isVoteStyleTag(tag);
  const color = safeCssColor(tag.color);
  const link = safeHttpLink(tag.link);

  let bg: string;
  let fg: string;
  if (voteStyle && score != null) {
    ({ bg, fg } = voteBadgeColors(score));
  } else {
    bg = color || (isIgnoredTag(tag) ? '#666' : '#455a64');
    fg = contrastText(bg);
  }

  const styleEl = document.createElement('style');
  styleEl.textContent =
    style === 'text'
      ? `
        :host { all: initial; }
        .badge {
          font: 600 11px/1.2 system-ui, -apple-system, sans-serif;
          color: ${voteStyle && score != null ? fg : bg};
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
  const up = tag.votesUp ?? 0;
  const down = tag.votesDown ?? 0;
  badge.title = [
    `u/${tag.username}`,
    tag.label ? `label: ${tag.label}` : null,
    isIgnoredTag(tag) ? 'ignored' : null,
    score != null ? `RES votes: +${up} / −${down} → ${formatNetVote(score)}` : null,
    link || null,
  ]
    .filter(Boolean)
    .join('\n');

  if (link) {
    const a = document.createElement('a');
    a.href = link;
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
  if (next?.classList.contains('linchpin-badge')) {
    next.remove();
  }
  authorEl.parentElement?.querySelectorAll(`.linchpin-badge[${BADGE_ATTR}]`).forEach((el) => {
    if (el.previousElementSibling === authorEl) el.remove();
  });
}

export function applyTagsToDocument(
  tags: UserTagMap,
  settings: Settings,
  root: ParentNode = document,
): void {
  if (!settings.reddit.tags) {
    root.querySelectorAll?.('.linchpin-badge')?.forEach((el) => el.remove());
    if (root instanceof Element && root.classList.contains('linchpin-badge')) root.remove();
    return;
  }

  const authors = findAuthorNodes(root);
  for (const { username, element } of authors) {
    const tag = tags[username];
    const signature = tag
      ? `${settings.reddit.tagBadgeStyle}:${tag.updatedAt}:${tag.label ?? ''}:${tag.color ?? ''}:${tag.ignore ? 1 : 0}:${tag.link ?? ''}:${tag.votesUp ?? ''}:${tag.votesDown ?? ''}`
      : 'none';
    if (element.dataset.linchpinTagSignature === signature) continue;
    element.dataset.linchpinTagSignature = signature;
    removeExistingBadge(element);
    if (!shouldShowBadge(tag)) continue;
    const badge = createBadge(tag, settings.reddit.tagBadgeStyle);
    element.insertAdjacentElement('afterend', badge);
  }
}
