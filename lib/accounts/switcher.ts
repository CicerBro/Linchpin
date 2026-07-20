import { accountRecoveryItem, getAccountStore, saveAccountStore, upsertAccount } from '../storage';
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
  partial: boolean;
  recoveryAvailable: boolean;
  message: string;
};

export type CaptureResult = {
  ok: boolean;
  cookieCount: number;
  sessionLooksValid: boolean;
  message: string;
};

export type RecoveryResult = {
  ok: boolean;
  cookiesSet: number;
  cookiesFailed: number;
  tabsReloaded: number;
  message: string;
};

let accountOperationTail: Promise<unknown> = Promise.resolve();

function withAccountSwitchLock<T>(operation: () => Promise<T>): Promise<T> {
  const result = accountOperationTail.then(operation, operation);
  accountOperationTail = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

/** Save the browser's current Reddit cookies onto an account slot. */
export async function captureSessionForAccount(accountId: string): Promise<CaptureResult> {
  return withAccountSwitchLock(() => captureSessionUnlocked(accountId));
}

async function captureSessionUnlocked(accountId: string): Promise<CaptureResult> {
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
  return withAccountSwitchLock(() => switchToAccountUnlocked(accountId));
}

async function switchToAccountUnlocked(accountId: string): Promise<SwitchResult> {
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
      partial: false,
      recoveryAvailable: false,
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
      partial: false,
      recoveryAvailable: false,
      message: 'No saved session — log in as this account, then Capture session',
    };
  }

  // Snapshot current cookies so we can restore if inject fails after clear.
  const previousCookies = await captureRedditCookies();
  const previousAccountId = store.activeAccountId;
  await accountRecoveryItem.setValue({
    createdAt: Date.now(),
    targetAccountId: accountId,
    previousAccountId,
    previousCookies,
    reason: 'Account switch is in progress',
  });

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
    let recoveryAvailable = previousCookies.length > 0;
    if (previousCookies.length > 0) {
      const restored = await injectRedditCookies(previousCookies);
      recoveryAvailable = restored.failed > 0;
      if (!recoveryAvailable) await accountRecoveryItem.setValue(null);
    }
    return {
      ok: false,
      accountId,
      cookiesSet: 0,
      cookiesFailed: failed,
      tabsReloaded: 0,
      needsRelogin: true,
      partial: false,
      recoveryAvailable,
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

  const partial = failed > 0;
  const needsRelogin = !looksOk || partial;
  if (partial) {
    await accountRecoveryItem.setValue({
      createdAt: Date.now(),
      targetAccountId: accountId,
      previousAccountId,
      previousCookies,
      reason: `${failed} target cookies could not be injected`,
    });
  } else {
    await accountRecoveryItem.setValue(null);
  }
  return {
    ok: true,
    accountId,
    cookiesSet: set,
    cookiesFailed: failed,
    tabsReloaded,
    needsRelogin,
    partial,
    recoveryAvailable: partial && previousCookies.length > 0,
    message: partial
      ? `Partial switch: ${set} cookies set and ${failed} failed. ${previousCookies.length ? 'Your prior session is retained for manual recovery. ' : ''}Re-capture this account or use TOTP to sign in again.`
      : needsRelogin
        ? `Switched, but the saved session appears expired. Use TOTP to sign in again, then Capture session.`
        : `Switched to “${account.label}” (${set} cookies, ${tabsReloaded} tabs reloaded)`,
  };
}

export function restorePreviousAccountSession(): Promise<RecoveryResult> {
  return withAccountSwitchLock(async () => {
    const recovery = await accountRecoveryItem.getValue();
    if (!recovery?.previousCookies.length) {
      return {
        ok: false,
        cookiesSet: 0,
        cookiesFailed: 0,
        tabsReloaded: 0,
        message: 'No recoverable Reddit session is stored',
      };
    }
    await clearRedditCookies();
    const result = await injectRedditCookies(recovery.previousCookies);
    if (result.set === 0 || result.failed > 0) {
      return {
        ok: false,
        cookiesSet: result.set,
        cookiesFailed: result.failed,
        tabsReloaded: 0,
        message: `Recovery was incomplete (${result.set} set, ${result.failed} failed). The recovery snapshot has been retained.`,
      };
    }
    const store = await getAccountStore();
    store.activeAccountId = recovery.previousAccountId;
    for (const account of store.accounts) {
      account.sessionStatus =
        account.id === recovery.previousAccountId
          ? 'active'
          : account.sessionStatus === 'active'
            ? 'saved'
            : account.sessionStatus;
    }
    await saveAccountStore(store);
    await accountRecoveryItem.setValue(null);
    const tabsReloaded = await reloadRedditTabs();
    return {
      ok: true,
      cookiesSet: result.set,
      cookiesFailed: 0,
      tabsReloaded,
      message: `Previous Reddit session restored (${tabsReloaded} tabs reloaded)`,
    };
  });
}
