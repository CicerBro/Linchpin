import type { FeatureSettings } from '../types';
import { voteBadgeColors } from './votes';

const STYLE_ID = 'linchpin-comment-score-styles';
const ORIG_ATTR = 'data-linchpin-score-orig';
export const MERGED_ATTR = 'data-linchpin-score-merged';
const CHIP_ATTR = 'data-linchpin-score-chip';
export const CHIP_CLASS = 'linchpin-comment-score';
const POS = 'linchpin-score-pos';
const NEG = 'linchpin-score-neg';
const ZERO = 'linchpin-score-zero';
const CLASSES = [POS, NEG, ZERO] as const;

/** Midcol only — tagline scores are replaced by a single injected chip. */
const MIDCOL_SCORE = '.thing.comment > .midcol .score';

let voteWatch: MutationObserver | null = null;
let voteClick: ((event: Event) => void) | null = null;
let voteRaf = 0;
const votePending = new Set<Element>();

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    /* Hide Reddit's triple tagline scores only when we replaced them. */
    .thing.comment[${CHIP_ATTR}] .tagline .score,
    .thing.comment[${MERGED_ATTR}] .tagline .score {
      display: none !important;
    }

    .${CHIP_CLASS} {
      display: inline-block;
      font: 700 10px/1.35 system-ui, -apple-system, sans-serif;
      border-radius: 3px;
      padding: 1px 4px;
      margin: 0 2px;
      vertical-align: baseline;
      box-sizing: border-box;
      letter-spacing: 0.01em;
      white-space: nowrap;
      border-style: solid;
      border-width: 1px;
    }
    .${CHIP_CLASS}.${POS} {
      color: #1b5e20;
      background: rgba(46, 125, 50, 0.18);
      border-color: rgba(46, 125, 50, 0.45);
    }
    .${CHIP_CLASS}.${NEG} {
      color: #b71c1c;
      background: rgba(198, 40, 40, 0.18);
      border-color: rgba(198, 40, 40, 0.45);
    }
    .${CHIP_CLASS}.${ZERO} {
      color: #424242;
      background: rgba(97, 97, 97, 0.14);
      border-color: rgba(97, 97, 97, 0.35);
    }

    /*
     * Old Reddit toggles likes/dislikes/unvoted on .midcol (and .entry),
     * not on .thing.comment — match that, or we permanently hide voted scores.
     */
    .thing.comment > .midcol:not(.likes):not(.dislikes) .score.likes,
    .thing.comment > .midcol:not(.likes):not(.dislikes) .score.dislikes,
    .thing.comment > .midcol.likes .score.unvoted,
    .thing.comment > .midcol.likes .score.dislikes,
    .thing.comment > .midcol.dislikes .score.unvoted,
    .thing.comment > .midcol.dislikes .score.likes {
      display: none !important;
    }
    .thing.comment > .midcol .score.${POS},
    .thing.comment > .midcol .score.${NEG},
    .thing.comment > .midcol .score.${ZERO} {
      font-weight: 700;
      border-radius: 3px;
      padding: 1px 4px;
      line-height: 1.35;
      box-sizing: border-box;
    }
    .thing.comment > .midcol .score.${POS} {
      color: #1b5e20 !important;
      background: rgba(46, 125, 50, 0.18);
      border: 1px solid rgba(46, 125, 50, 0.45);
    }
    .thing.comment > .midcol .score.${NEG} {
      color: #b71c1c !important;
      background: rgba(198, 40, 40, 0.18);
      border: 1px solid rgba(198, 40, 40, 0.45);
    }
    .thing.comment > .midcol .score.${ZERO} {
      color: #424242 !important;
      background: rgba(97, 97, 97, 0.14);
      border: 1px solid rgba(97, 97, 97, 0.35);
    }
  `;
  document.documentElement.appendChild(style);
}

function removeStyles(): void {
  document.getElementById(STYLE_ID)?.remove();
}

/** Parse "12 points", "-3", "1 point†"; skip hidden / bullet placeholders. */
export function parseCommentScore(text: string): number | null {
  const t = text.trim();
  if (!t || t === '•' || /score hidden/i.test(t)) return null;
  const m = t.match(/^([+-]?\d+)\b/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

export function formatCommentScore(score: number, controversial = false): string {
  const label = score > 0 ? `+${score}` : String(score);
  return controversial ? `${label}†` : label;
}

function scoreClass(score: number): (typeof CLASSES)[number] {
  if (score > 0) return POS;
  if (score < 0) return NEG;
  return ZERO;
}

/** Old Reddit sets likes/dislikes on .midcol + .entry, not the .thing. */
export function commentVoteState(comment: Element): 'likes' | 'dislikes' | 'unvoted' {
  const midcol = comment.querySelector(':scope > .midcol');
  const entry = comment.querySelector(':scope > .entry');
  for (const el of [midcol, entry, comment]) {
    if (!el) continue;
    if (el.classList.contains('likes')) return 'likes';
    if (el.classList.contains('dislikes')) return 'dislikes';
  }
  if (midcol?.querySelector('.arrow.upmod')) return 'likes';
  if (midcol?.querySelector('.arrow.downmod')) return 'dislikes';
  return 'unvoted';
}

function restoreScore(el: Element): void {
  const orig = el.getAttribute(ORIG_ATTR);
  if (orig != null) {
    el.textContent = orig;
    el.removeAttribute(ORIG_ATTR);
  }
  el.classList.remove(...CLASSES);
}

function applyMidcolScore(el: Element): void {
  if (!el.hasAttribute(ORIG_ATTR)) {
    el.setAttribute(ORIG_ATTR, (el.textContent || '').trim());
  }
  const orig = el.getAttribute(ORIG_ATTR) || '';
  const score = parseCommentScore(orig);
  el.classList.remove(...CLASSES);
  if (score == null) {
    if (el.getAttribute(ORIG_ATTR) === (el.textContent || '').trim()) {
      el.removeAttribute(ORIG_ATTR);
    }
    return;
  }
  el.classList.add(scoreClass(score));
  el.textContent = formatCommentScore(score, /†/.test(orig));
}

function scoreFromContainer(
  container: Element | null,
  preferred: 'likes' | 'dislikes' | 'unvoted',
): { score: number; controversial: boolean; raw: string } | null {
  if (!container) return null;
  const scores = Array.from(container.querySelectorAll('.score'));
  const ordered = [
    ...scores.filter((el) => el.classList.contains(preferred)),
    ...scores.filter((el) => el.classList.contains('unvoted')),
    ...scores,
  ];
  for (const el of ordered) {
    const raw = (el.getAttribute(ORIG_ATTR) || el.textContent || '').trim();
    const score = parseCommentScore(raw);
    if (score == null) continue;
    return { score, controversial: /†/.test(raw), raw };
  }
  return null;
}

/** Prefer midcol integers for the active vote state; fall back to tagline. */
export function readCommentTaglineScore(
  from: Element,
): { score: number; controversial: boolean; raw: string } | null {
  const comment =
    from.closest('.thing.comment') ??
    (from instanceof Element && from.classList.contains('comment') ? from : null);
  if (!comment) return null;

  const preferred = commentVoteState(comment);
  const midcol = comment.querySelector(':scope > .midcol');
  const fromMidcol = scoreFromContainer(midcol, preferred);
  if (fromMidcol) return fromMidcol;

  const tagline =
    comment.querySelector(':scope > .entry .tagline') || comment.querySelector('.tagline');
  return scoreFromContainer(tagline, preferred);
}

function removeChip(comment: Element): void {
  comment.querySelector(`:scope > .entry .tagline .${CHIP_CLASS}, .tagline .${CHIP_CLASS}`)?.remove();
  comment.removeAttribute(CHIP_ATTR);
}

function upsertTaglineChip(comment: Element): void {
  if (comment.hasAttribute(MERGED_ATTR)) {
    removeChip(comment);
    return;
  }

  const tagline =
    comment.querySelector(':scope > .entry .tagline') || comment.querySelector('.tagline');
  if (!tagline) return;

  const info = readCommentTaglineScore(comment);
  if (!info) {
    removeChip(comment);
    return;
  }

  let chip = tagline.querySelector(`.${CHIP_CLASS}`) as HTMLElement | null;
  if (!chip) {
    chip = document.createElement('span');
    chip.className = CHIP_CLASS;
    const anchor = tagline.querySelector('.score');
    if (anchor) anchor.before(chip);
    else tagline.append(chip);
  }

  chip.classList.remove(...CLASSES);
  chip.classList.add(scoreClass(info.score));
  chip.textContent = formatCommentScore(info.score, info.controversial);
  chip.title = info.raw;
  comment.setAttribute(CHIP_ATTR, '1');
}

function refreshMergedPts(comment: Element): void {
  if (!comment.hasAttribute(MERGED_ATTR)) return;
  const info = readCommentTaglineScore(comment);
  if (!info) return;

  const badge =
    comment.querySelector(':scope > .entry .tagline .linchpin-badge') ||
    comment.querySelector('.tagline .linchpin-badge');
  const shadow = badge?.shadowRoot;
  if (!shadow) return;

  const part = shadow.querySelector('.part.comment') as HTMLElement | null;
  const val = shadow.querySelector('.part.comment .val') as HTMLElement | null;
  const hostBadge = shadow.querySelector('.badge') as HTMLElement | null;
  if (!part || !val) return;

  const colors = voteBadgeColors(info.score);
  part.style.background = colors.bg;
  part.style.color = colors.fg;
  part.style.borderColor = colors.border;
  val.textContent = formatCommentScore(info.score, info.controversial);

  if (hostBadge?.title) {
    const lines = hostBadge.title.split('\n');
    const next = lines.map((line) =>
      line.startsWith('This comment:')
        ? `This comment: ${formatCommentScore(info.score, info.controversial)}`
        : line,
    );
    hostBadge.title = next.join('\n');
  }
}

/** Re-read Reddit's vote-state scores and update our chip / dual pts / midcol. */
export function refreshCommentScore(comment: Element): void {
  if (!(comment instanceof Element) || !comment.classList.contains('comment')) return;
  upsertTaglineChip(comment);
  refreshMergedPts(comment);
  comment.querySelectorAll(':scope > .midcol .score').forEach(applyMidcolScore);
}

function flushVotePending(): void {
  voteRaf = 0;
  for (const comment of votePending) refreshCommentScore(comment);
  votePending.clear();
}

function queueVoteRefresh(from: Element): void {
  const comment = from.closest('.thing.comment');
  if (!comment) return;
  votePending.add(comment);
  if (voteRaf) return;
  voteRaf = requestAnimationFrame(flushVotePending);
}

function isVoteClassTarget(el: Element): boolean {
  return (
    el.classList.contains('midcol') ||
    el.classList.contains('entry') ||
    el.classList.contains('arrow') ||
    el.classList.contains('comment')
  );
}

function onVoteClick(event: Event): void {
  const target = event.target;
  if (!(target instanceof Element)) return;
  if (!target.closest('.arrow.up, .arrow.down, .arrow.upmod, .arrow.downmod')) return;
  const comment = target.closest('.thing.comment');
  if (!comment) return;
  queueVoteRefresh(comment);
  // Reddit toggles classes in the same turn; also catch any delayed paint.
  window.setTimeout(() => refreshCommentScore(comment), 0);
  window.setTimeout(() => refreshCommentScore(comment), 50);
}

function startVoteWatch(): void {
  if (!voteWatch) {
    voteWatch = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type !== 'attributes' || mutation.attributeName !== 'class') continue;
        const target = mutation.target;
        if (!(target instanceof Element) || !isVoteClassTarget(target)) continue;
        queueVoteRefresh(target);
      }
    });
    voteWatch.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
      subtree: true,
    });
  }
  if (!voteClick) {
    voteClick = onVoteClick;
    document.addEventListener('click', voteClick, true);
  }
}

function stopVoteWatch(): void {
  voteWatch?.disconnect();
  voteWatch = null;
  if (voteClick) {
    document.removeEventListener('click', voteClick, true);
    voteClick = null;
  }
  if (voteRaf) cancelAnimationFrame(voteRaf);
  voteRaf = 0;
  votePending.clear();
}

function clearAll(): void {
  stopVoteWatch();
  document.querySelectorAll(`.${CHIP_CLASS}`).forEach((el) => el.remove());
  document.querySelectorAll(`[${CHIP_ATTR}]`).forEach((el) => el.removeAttribute(CHIP_ATTR));
  document.querySelectorAll(`[${ORIG_ATTR}], .${POS}, .${NEG}, .${ZERO}`).forEach((el) => {
    if (el.classList.contains(CHIP_CLASS)) return;
    restoreScore(el);
  });
  document.querySelectorAll(`[${MERGED_ATTR}]`).forEach((el) => el.removeAttribute(MERGED_ATTR));
  removeStyles();
}

/**
 * One tagline chip per comment (+N / −N). Midcol gets the same treatment.
 * When a dual user-vote chip owns the score, MERGED_ATTR suppresses the tagline chip.
 * Vote-state class changes on .midcol/.entry refresh chips live.
 */
export function applyCommentScoreColors(
  settings: FeatureSettings,
  root: ParentNode = document,
): void {
  if (!settings.reddit.commentScoreColors) {
    clearAll();
    return;
  }

  ensureStyles();
  startVoteWatch();

  const comments: Element[] = [];
  if (root instanceof Element && root.matches('.thing.comment')) comments.push(root);
  comments.push(...Array.from(root.querySelectorAll?.('.thing.comment') ?? []));
  for (const comment of comments) {
    upsertTaglineChip(comment);
    refreshMergedPts(comment);
  }

  const midcol: Element[] = [];
  if (root instanceof Element && root.matches(MIDCOL_SCORE)) midcol.push(root);
  midcol.push(...Array.from(root.querySelectorAll?.(MIDCOL_SCORE) ?? []));
  for (const el of midcol) applyMidcolScore(el);
}

export function setCommentScoreMerged(authorEl: HTMLElement, merged: boolean): void {
  const comment = authorEl.closest('.thing.comment');
  if (!comment) return;
  if (merged) {
    comment.setAttribute(MERGED_ATTR, '1');
    removeChip(comment);
  } else {
    comment.removeAttribute(MERGED_ATTR);
  }
}
