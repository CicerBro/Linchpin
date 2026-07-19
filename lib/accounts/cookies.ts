import type { StoredCookie } from '../types';

/** Minimal cookie shape from browser.cookies.getAll / set. */
type BrowserCookie = {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite?: string;
  expirationDate?: number;
  storeId?: string;
};

/**
 * Only *.reddit.com cookie domains — matches host_permissions in wxt.config.ts.
 * Do not touch redd.it / redditmedia / redditstatic (no host permission).
 */
const REDDIT_DOMAIN_RE = /(^|\.)reddit\.com$/i;

export function isRedditCookieDomain(domain: string): boolean {
  const d = domain.replace(/^\./, '').toLowerCase();
  return REDDIT_DOMAIN_RE.test(d) || REDDIT_DOMAIN_RE.test(`.${d}`);
}

const URLS_TO_SCAN = [
  'https://www.reddit.com/',
  'https://old.reddit.com/',
  'https://reddit.com/',
];

function cookieUrl(c: {
  domain: string;
  path: string;
  secure: boolean;
}): string {
  const host = c.domain.startsWith('.') ? c.domain.slice(1) : c.domain;
  const scheme = c.secure ? 'https' : 'http';
  return `${scheme}://${host}${c.path || '/'}`;
}

function toStored(c: BrowserCookie): StoredCookie | null {
  if (!isRedditCookieDomain(c.domain)) return null;
  const sameSite =
    c.sameSite === 'no_restriction' ||
    c.sameSite === 'lax' ||
    c.sameSite === 'strict'
      ? c.sameSite
      : 'unspecified';

  const stored: StoredCookie = {
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path,
    secure: c.secure,
    httpOnly: c.httpOnly,
    sameSite,
  };
  if (typeof c.expirationDate === 'number') {
    stored.expirationDate = c.expirationDate;
  }
  if (c.storeId) stored.storeId = c.storeId;
  return stored;
}

function dedupeKey(c: StoredCookie): string {
  return `${c.domain}|${c.path}|${c.name}`;
}

/** Capture all Reddit-related cookies currently in the browser. */
export async function captureRedditCookies(): Promise<StoredCookie[]> {
  const byKey = new Map<string, StoredCookie>();

  for (const url of URLS_TO_SCAN) {
    const list = await browser.cookies.getAll({ url });
    for (const c of list) {
      const stored = toStored(c);
      if (!stored) continue;
      byKey.set(dedupeKey(stored), stored);
    }
  }

  const domainCookies = await browser.cookies.getAll({ domain: 'reddit.com' });
  for (const c of domainCookies) {
    const stored = toStored(c);
    if (!stored) continue;
    byKey.set(dedupeKey(stored), stored);
  }

  return Array.from(byKey.values());
}

/** Remove Reddit session cookies (only reddit-related domains). */
export async function clearRedditCookies(): Promise<number> {
  const current = await captureRedditCookies();
  let removed = 0;
  for (const c of current) {
    const url = cookieUrl(c);
    try {
      const ok = await browser.cookies.remove({
        url,
        name: c.name,
        storeId: c.storeId,
      });
      if (ok) removed++;
    } catch {
      // Best-effort; some Brave partitions may reject individual removes
    }
  }
  return removed;
}

/**
 * Inject a previously captured Reddit cookie set.
 * Only sets cookies whose domain passes the Reddit allowlist.
 */
export async function injectRedditCookies(
  cookies: StoredCookie[],
): Promise<{ set: number; failed: number }> {
  let set = 0;
  let failed = 0;

  for (const c of cookies) {
    if (!isRedditCookieDomain(c.domain)) {
      failed++;
      continue;
    }
    const url = cookieUrl(c);
    try {
      const details: Parameters<typeof browser.cookies.set>[0] = {
        url,
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path || '/',
        secure: c.secure,
        httpOnly: c.httpOnly,
        storeId: c.storeId,
      };
      if (c.sameSite !== 'unspecified') {
        details.sameSite = c.sameSite;
      }
      if (
        typeof c.expirationDate === 'number' &&
        c.expirationDate > Date.now() / 1000
      ) {
        details.expirationDate = c.expirationDate;
      }
      const result = await browser.cookies.set(details);
      if (result) set++;
      else failed++;
    } catch {
      failed++;
    }
  }

  return { set, failed };
}

/**
 * Heuristic: real login cookies only.
 * `session_tracker` is too weak — logged-out users often still have it.
 */
export function sessionLooksValid(cookies: StoredCookie[]): boolean {
  const names = new Set(cookies.map((c) => c.name));
  return names.has('reddit_session') || names.has('token_v2');
}

export async function reloadRedditTabs(): Promise<number> {
  const tabs = await browser.tabs.query({
    url: ['*://*.reddit.com/*', '*://reddit.com/*'],
  });
  let n = 0;
  for (const tab of tabs) {
    if (tab.id == null) continue;
    try {
      await browser.tabs.reload(tab.id);
      n++;
    } catch {
      // ignore
    }
  }
  return n;
}
