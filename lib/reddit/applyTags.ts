import type { Settings, UserTag, UserTagMap } from '../types';
import { isIgnoredTag } from '../storage';
import { findAuthorNodes } from './authors';
import {
  formatCommentScore,
  readCommentTaglineScore,
  setCommentScoreMerged,
} from './commentScores';
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
  // Custom label/ignore wins. Color alone should not block the vote chip
  // (RES imports often set a color on vote-only tags).
  if (tag.label?.trim() || isIgnoredTag(tag)) return false;
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

function appendHint(parent: HTMLElement, text: string): void {
  const hint = document.createElement('span');
  hint.className = 'hint';
  hint.textContent = text;
  parent.append(hint);
}

function createBadge(
  tag: UserTag,
  style: Settings['reddit']['tagBadgeStyle'],
  commentScore: { score: number; controversial: boolean } | null,
): HTMLElement {
  const host = document.createElement('span');
  host.className = 'linchpin-badge';
  host.setAttribute(BADGE_ATTR, tag.username);
  host.style.display = 'inline-flex';
  host.style.alignItems = 'center';
  host.style.marginLeft = '4px';
  host.style.marginRight = '4px';
  host.style.verticalAlign = 'middle';

  const shadow = host.attachShadow({ mode: 'open' });
  const userScore = netVoteScore(tag);
  const voteStyle = isVoteStyleTag(tag);
  const dual = Boolean(voteStyle && userScore != null && commentScore);
  const color = safeCssColor(tag.color);
  const link = safeHttpLink(tag.link);
  const label = badgeLabel(tag);
  const up = tag.votesUp ?? 0;
  const down = tag.votesDown ?? 0;

  const styleEl = document.createElement('style');

  if (dual && userScore != null && commentScore) {
    const userColors = voteBadgeColors(userScore);
    const commentColors = voteBadgeColors(commentScore.score);
    styleEl.textContent = `
      :host { all: initial; }
      .badge {
        display: inline-flex;
        align-items: stretch;
        font: 600 10px/1.35 system-ui, -apple-system, sans-serif;
        border-radius: 4px;
        white-space: nowrap;
        letter-spacing: 0.01em;
        vertical-align: middle;
      }
      .part {
        display: inline-flex;
        align-items: center;
        padding: 1px 5px;
        box-sizing: border-box;
      }
      .part.comment {
        background: ${commentColors.bg};
        color: ${commentColors.fg};
        border: 1px solid ${commentColors.border};
        border-radius: 4px 0 0 4px;
      }
      .part.user {
        background: ${userColors.bg};
        color: ${userColors.fg};
        border: 1px solid ${userColors.border};
        border-left: none;
        border-radius: 0 4px 4px 0;
      }
      .hint {
        opacity: 0.65;
        font-weight: 500;
        margin-right: 3px;
        font-size: 9px;
        letter-spacing: 0.02em;
        text-transform: uppercase;
      }
      a {
        display: inline-flex;
        align-items: stretch;
        color: inherit;
        text-decoration: none;
      }
    `;

    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.title = [
      `u/${tag.username}`,
      `Your votes on this user: ${formatNetVote(userScore)} (${up}↑ ${down}↓)`,
      `This comment: ${formatCommentScore(commentScore.score, commentScore.controversial)}`,
      link || null,
    ]
      .filter(Boolean)
      .join('\n');

    const commentPart = document.createElement('span');
    commentPart.className = 'part comment';
    appendHint(commentPart, 'pts');
    const commentVal = document.createElement('span');
    commentVal.className = 'val';
    commentVal.textContent = formatCommentScore(
      commentScore.score,
      commentScore.controversial,
    );
    commentPart.append(commentVal);

    const userPart = document.createElement('span');
    userPart.className = 'part user';
    appendHint(userPart, 'you');
    const userVal = document.createElement('span');
    userVal.className = 'val';
    userVal.textContent = formatNetVote(userScore);
    userPart.append(userVal);

    if (link) {
      const a = document.createElement('a');
      a.href = link;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.append(commentPart, userPart);
      badge.append(a);
    } else {
      badge.append(commentPart, userPart);
    }

    shadow.append(styleEl, badge);
    return host;
  }

  let bg: string;
  let fg: string;
  let border: string | undefined;
  if (voteStyle && userScore != null) {
    ({ bg, fg, border } = voteBadgeColors(userScore));
  } else {
    bg = color || (isIgnoredTag(tag) ? '#666' : '#455a64');
    fg = contrastText(bg);
  }

  styleEl.textContent =
    style === 'text'
      ? `
        :host { all: initial; }
        .badge {
          font: 600 11px/1.2 system-ui, -apple-system, sans-serif;
          color: ${voteStyle && userScore != null ? fg : bg};
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
          font: 600 10px/1.35 system-ui, -apple-system, sans-serif;
          padding: 1px 6px;
          border-radius: 4px;
          background: ${bg};
          color: ${fg};
          ${border ? `border: 1px solid ${border};` : ''}
          white-space: nowrap;
          letter-spacing: 0.01em;
          box-sizing: border-box;
        }
        a { color: inherit; text-decoration: none; }
      `;

  const badge = document.createElement('span');
  badge.className = 'badge';
  badge.title = [
    `u/${tag.username}`,
    tag.label ? `label: ${tag.label}` : null,
    isIgnoredTag(tag) ? 'ignored' : null,
    userScore != null ? `Your votes on this user: ${formatNetVote(userScore)} (${up}↑ ${down}↓)` : null,
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
  setCommentScoreMerged(authorEl, false);
}

export function applyTagsToDocument(
  tags: UserTagMap,
  settings: Settings,
  root: ParentNode = document,
): void {
  if (!settings.reddit.tags) {
    root.querySelectorAll?.('.linchpin-badge')?.forEach((el) => {
      const prev = el.previousElementSibling;
      if (prev instanceof HTMLElement) setCommentScoreMerged(prev, false);
      el.remove();
    });
    if (root instanceof Element && root.classList.contains('linchpin-badge')) {
      const prev = root.previousElementSibling;
      if (prev instanceof HTMLElement) setCommentScoreMerged(prev, false);
      root.remove();
    }
    return;
  }

  const authors = findAuthorNodes(root);
  for (const { username, element } of authors) {
    const tag = tags[username];

    let mergedScore: { score: number; controversial: boolean } | null = null;
    if (tag && isVoteStyleTag(tag) && settings.reddit.commentScoreColors) {
      const read = readCommentTaglineScore(element);
      if (read) mergedScore = { score: read.score, controversial: read.controversial };
    }

    const signature = tag
      ? `${settings.reddit.tagBadgeStyle}:${tag.updatedAt}:${tag.label ?? ''}:${tag.color ?? ''}:${tag.ignore ? 1 : 0}:${tag.link ?? ''}:${tag.votesUp ?? ''}:${tag.votesDown ?? ''}:${settings.reddit.commentScoreColors ? 1 : 0}:${mergedScore?.score ?? ''}:${mergedScore?.controversial ? 1 : 0}`
      : 'none';
    if (element.dataset.linchpinTagSignature === signature) continue;
    element.dataset.linchpinTagSignature = signature;
    removeExistingBadge(element);
    if (!shouldShowBadge(tag)) continue;
    const badge = createBadge(tag, settings.reddit.tagBadgeStyle, mergedScore);
    element.insertAdjacentElement('afterend', badge);
    setCommentScoreMerged(element, Boolean(mergedScore));
  }
}
