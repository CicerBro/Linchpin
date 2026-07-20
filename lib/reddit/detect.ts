import type { RedditUiVersion } from '../types';

export function detectRedditUi(doc: Document = document): RedditUiVersion {
  const host = location.hostname;

  if (host.startsWith('old.') || host.startsWith('i.')) {
    return 'old';
  }

  // Classic old.reddit markup still appears on some www pages / redirects
  if (doc.body?.classList.contains('listing-page') || doc.getElementById('siteTable')) {
    return 'old';
  }

  // New Reddit (shreddit / faceplate)
  if (
    doc.querySelector('shreddit-app, shreddit-feed, faceplate-app') ||
    doc.documentElement?.getAttribute('data-theme') != null
  ) {
    return 'new';
  }

  // Fallback: presence of .thing posts ⇒ old
  if (doc.querySelector('.thing.link, .thing.comment, a.author')) {
    return 'old';
  }

  return 'unknown';
}

export function isOldRedditListingPage(): boolean {
  if (detectRedditUi() !== 'old') return false;
  const path = location.pathname;
  // Skip comment threads and submit/message pages
  if (/\/comments\//i.test(path)) return false;
  if (/\/(submit|message|prefs|login|register)\b/i.test(path)) return false;
  return Boolean(document.getElementById('siteTable') || document.querySelector('.sitetable'));
}

let loggedOnce = false;

export function logUiDetectionOnce(): RedditUiVersion {
  const ui = detectRedditUi();
  if (!loggedOnce) {
    loggedOnce = true;
    console.info(`[linchpin] Reddit UI detected: ${ui} (${location.hostname})`);
  }
  return ui;
}
