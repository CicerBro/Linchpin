import {
  getAccountStore,
  saveAccountStore,
  upsertAccount,
} from '../storage';
import type { StoredAccount } from '../types';
import {
  captureRedditCookies,
  clearRedditCookies,
  injectRedditCookies,
  reloadRedditTabs,
  sessionLooksValid,
} from './cookies';

export type SwitchResult = {
  ok: boolean;
  accountId: string;
  cookiesSet: number;
  cookiesFailed: number;
  tabsReloaded: number;
  needsRelogin: boolean;
  message: string;
};

export type CaptureResult = {
  ok: boolean;
  cookieCount: number;
  sessionLooksValid: boolean;
  message: string;
};

/** Save the browser's current Reddit cookies onto an account slot. */
export async function captureSessionForAccount(
  accountId: string,
): Promise<CaptureResult> {
  const store = await getAccountStore();
  const account = store.accounts.find((a) => a.id === accountId);
  if (!account) {
    return {
      ok: false,
      cookieCount: 0,
      sessionLooksValid: false,
      message: 'Account not found',
    };
  }

  const cookies = await captureRedditCookies();
  const valid = sessionLooksValid(cookies);

  const next: StoredAccount = {
    ...account,
    cookies,
    sessionStatus: valid ? 'saved' : cookies.length ? 'expired' : 'unknown',
    savedAt: Date.now(),
  };
  await upsertAccount(next);

  return {
    ok: cookies.length > 0,
    cookieCount: cookies.length,
    sessionLooksValid: valid,
    message: valid
      ? `Saved ${cookies.length} Reddit cookies`
      : cookies.length
        ? `Saved ${cookies.length} cookies — session may be incomplete; log in and capture again`
        : 'No Reddit cookies found — log into Reddit first',
  };
}

/** Swap browser Reddit cookies to the selected account and reload Reddit tabs. */
export async function switchToAccount(accountId: string): Promise<SwitchResult> {
  const store = await getAccountStore();
  const account = store.accounts.find((a) => a.id === accountId);
  if (!account) {
    return {
      ok: false,
      accountId,
      cookiesSet: 0,
      cookiesFailed: 0,
      tabsReloaded: 0,
      needsRelogin: true,
      message: 'Account not found',
    };
  }

  if (!account.cookies.length) {
    return {
      ok: false,
      accountId,
      cookiesSet: 0,
      cookiesFailed: 0,
      tabsReloaded: 0,
      needsRelogin: true,
      message: 'No saved session — log in as this account, then Capture session',
    };
  }

  // Snapshot current cookies so we can restore if inject fails after clear.
  const previousCookies = await captureRedditCookies();

  // Mark previous active as saved (not active) — only persist after a successful inject.
  for (const a of store.accounts) {
    if (a.id === store.activeAccountId && a.sessionStatus === 'active') {
      a.sessionStatus = a.cookies.length ? 'saved' : 'unknown';
    }
  }

  await clearRedditCookies();

  let set = 0;
  let failed = 0;
  try {
    const result = await injectRedditCookies(account.cookies);
    set = result.set;
    failed = result.failed;
  } catch {
    // Treat unexpected inject errors as total failure so we roll back.
    set = 0;
    failed = account.cookies.length || 1;
  }

  // Inject failed badly (nothing set) — restore prior cookies so the user is not logged out.
  if (set === 0) {
    if (previousCookies.length > 0) {
      await injectRedditCookies(previousCookies);
    }
    return {
      ok: false,
      accountId,
      cookiesSet: 0,
      cookiesFailed: failed,
      tabsReloaded: 0,
      needsRelogin: true,
      message:
        'Switch failed — previous session restored. Re-capture this account or log in and Capture session.',
    };
  }

  const tabsReloaded = await reloadRedditTabs();

  const looksOk = sessionLooksValid(account.cookies) && set > 0;
  account.sessionStatus = looksOk ? 'active' : 'expired';
  account.lastSwitchedAt = Date.now();
  store.activeAccountId = accountId;
  await saveAccountStore(store);

  const needsRelogin = !looksOk || failed > set;
  return {
    ok: true,
    accountId,
    cookiesSet: set,
    cookiesFailed: failed,
    tabsReloaded,
    needsRelogin,
    message: needsRelogin
      ? `Switched with issues (${set} set, ${failed} failed). Session may be expired — use TOTP and re-login, then Capture session.`
      : `Switched to “${account.label}” (${set} cookies, ${tabsReloaded} tabs reloaded)`,
  };
}
