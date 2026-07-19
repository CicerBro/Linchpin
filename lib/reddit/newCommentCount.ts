import {
  getThreadVisits,
  recordThreadVisit,
} from '../storage';
import type { Settings, ThreadVisit } from '../types';
import { detectRedditUi } from './detect';

const BANNER_ID = 'rivet-new-comment-banner';
const NEW_ATTR = 'data-rivet-new-comment';

function ensureStyles(): void {
  if (document.getElementById('rivet-ncc-styles')) return;
  const style = document.createElement('style');
  style.id = 'rivet-ncc-styles';
  style.textContent = `
    #${BANNER_ID} {
      font: 13px/1.4 system-ui, -apple-system, sans-serif;
      padding: 8px 12px;
      margin: 8px 0;
      background: #fff8e1;
      border: 1px solid #ffe082;
      border-radius: 4px;
      color: #5d4037;
    }
    #${BANNER_ID} button {
      font: inherit;
      margin-left: 8px;
      cursor: pointer;
      padding: 2px 8px;
    }
    [${NEW_ATTR}] {
      outline: 2px solid #ffb300;
      outline-offset: 2px;
    }
    .thing.comment[${NEW_ATTR}] {
      background: #fffde7;
    }
  `;
  document.documentElement.appendChild(style);
}

/** Parse t3_ fullname / id from comments URL or page. */
export function threadFullnameFromPage(): string | null {
  const path = location.pathname;
  const m = path.match(/\/comments\/([a-z0-9]+)(?:\/|$)/i);
  if (m) return `t3_${m[1].toLowerCase()}`;

  const thing =
    document.querySelector('.thing.link[data-fullname]') ||
    document.querySelector('shreddit-post[id]');
  if (thing) {
    const id =
      thing.getAttribute('data-fullname') ||
      thing.getAttribute('id') ||
      '';
    if (/^t3_/i.test(id)) return id.toLowerCase();
    if (/^[a-z0-9]+$/i.test(id)) return `t3_${id.toLowerCase()}`;
  }
  return null;
}

function countCommentsOld(): number {
  // Prefer the explicit count in the link listing entry
  const link = document.querySelector('.thing.link .comments');
  if (link?.textContent) {
    const n = parseInt(link.textContent.replace(/[^\d]/g, ''), 10);
    if (!Number.isNaN(n)) return n;
  }
  return document.querySelectorAll('.thing.comment:not(.deleted)').length;
}

function countCommentsNew(): number {
  const post = document.querySelector('shreddit-post');
  const attr = post?.getAttribute('comment-count');
  if (attr) {
    const n = parseInt(attr, 10);
    if (!Number.isNaN(n)) return n;
  }
  const meta = document.querySelector(
    'faceplate-number[number], [data-testid="comment-count"]',
  );
  if (meta) {
    const n = parseInt((meta.textContent || '').replace(/[^\d]/g, ''), 10);
    if (!Number.isNaN(n)) return n;
  }
  return document.querySelectorAll('shreddit-comment').length;
}

function currentCommentCount(): number {
  return detectRedditUi() === 'old' ? countCommentsOld() : countCommentsNew();
}

function commentTimestamp(el: Element): number | null {
  const time =
    el.querySelector('time[datetime]') ||
    el.querySelector('[datetime]') ||
    el.querySelector('faceplate-timeago');
  const dt =
    time?.getAttribute('datetime') ||
    time?.getAttribute('ts') ||
    null;
  if (!dt) return null;
  // faceplate may use seconds
  if (/^\d+$/.test(dt)) {
    const n = Number(dt);
    return n < 1e12 ? n * 1000 : n;
  }
  const parsed = Date.parse(dt);
  return Number.isNaN(parsed) ? null : parsed;
}

function highlightNewComments(since: number): number {
  ensureStyles();
  let highlighted = 0;
  const ui = detectRedditUi();
  const nodes =
    ui === 'old'
      ? document.querySelectorAll('.thing.comment')
      : document.querySelectorAll('shreddit-comment');

  nodes.forEach((el) => {
    const ts = commentTimestamp(el);
    if (ts != null && ts > since) {
      el.setAttribute(NEW_ATTR, '1');
      highlighted++;
    } else {
      el.removeAttribute(NEW_ATTR);
    }
  });
  return highlighted;
}

function showBanner(
  delta: number,
  previous: ThreadVisit,
  onDismiss: () => void,
): void {
  ensureStyles();
  let banner = document.getElementById(BANNER_ID);
  if (!banner) {
    banner = document.createElement('div');
    banner.id = BANNER_ID;
    const anchor =
      document.querySelector('.commentarea > .panestack-title') ||
      document.querySelector('.commentarea') ||
      document.querySelector('shreddit-comments-sort-dropdown') ||
      document.querySelector('#comment-tree') ||
      document.querySelector('shreddit-comment-tree');
    if (anchor) anchor.insertAdjacentElement('beforebegin', banner);
    else document.body.prepend(banner);
  }

  const when = new Date(previous.visitedAt).toLocaleString();
  banner.innerHTML = '';
  const span = document.createElement('span');
  span.textContent =
    delta > 0
      ? `${delta} new comment${delta === 1 ? '' : 's'} since your last visit (${when}).`
      : `No new comments since your last visit (${when}).`;
  banner.appendChild(span);

  if (delta > 0) {
    const jump = document.createElement('button');
    jump.type = 'button';
    jump.textContent = 'Highlight new';
    jump.addEventListener('click', () => {
      highlightNewComments(previous.visitedAt);
      const first = document.querySelector(`[${NEW_ATTR}]`);
      first?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    banner.appendChild(jump);
  }

  const dismiss = document.createElement('button');
  dismiss.type = 'button';
  dismiss.textContent = 'Dismiss';
  dismiss.addEventListener('click', () => {
    banner?.remove();
    onDismiss();
  });
  banner.appendChild(dismiss);
}

/**
 * On comment threads: compare stored visit → show new-comment banner,
 * highlight newer comments, then update the stored count after a delay.
 */
export function startNewCommentCounts(settings: Settings): () => void {
  if (!settings.enableNewCommentCounts) {
    document.getElementById(BANNER_ID)?.remove();
    document.querySelectorAll(`[${NEW_ATTR}]`).forEach((el) => {
      el.removeAttribute(NEW_ATTR);
    });
    return () => undefined;
  }

  if (!/\/comments\//i.test(location.pathname)) {
    return () => undefined;
  }

  const fullname = threadFullnameFromPage();
  if (!fullname) return () => undefined;

  let cancelled = false;
  let timer: number | undefined;

  void (async () => {
    const visits = await getThreadVisits();
    if (cancelled) return;

    const previous = visits[fullname];
    const count = currentCommentCount();

    if (previous) {
      const delta = Math.max(0, count - previous.commentCount);
      showBanner(delta, previous, () => undefined);
      if (delta > 0) highlightNewComments(previous.visitedAt);
    }

    // Persist this visit after a short dwell so refresh mid-read keeps prior stamp useful
    timer = window.setTimeout(() => {
      if (cancelled) return;
      void recordThreadVisit(fullname, currentCommentCount(), location.pathname);
    }, 5000);
  })();

  return () => {
    cancelled = true;
    if (timer) window.clearTimeout(timer);
  };
}
