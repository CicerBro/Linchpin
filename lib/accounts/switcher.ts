import { getAccountStore, saveAccountStore } from '../storage';
import type { StoredAccount } from '../types';
import type { LinchpinMessage } from './messages';
import type { RedditLoginResult } from './redditLogin';
import { generateTotp } from './totp';

const REDDIT_TAB_URLS = ['*://*.reddit.com/*', '*://reddit.com/*'];

export type SwitchResult = {
  ok: boolean;
  accountId: string;
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

function isRedditUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname === 'reddit.com' || hostname.endsWith('.reddit.com');
  } catch {
    return false;
  }
}

async function findRedditTab(preferredTabId?: number): Promise<number | null> {
  if (preferredTabId != null) {
    try {
      const preferred = await browser.tabs.get(preferredTabId);
      if (isRedditUrl(preferred.url)) return preferredTabId;
    } catch {
      // The sender tab may have closed while the switch request was queued.
    }
  }

  const active = await browser.tabs.query({
    active: true,
    currentWindow: true,
    url: REDDIT_TAB_URLS,
  });
  if (active[0]?.id != null) return active[0].id;

  const anyRedditTab = await browser.tabs.query({ url: REDDIT_TAB_URLS });
  return anyRedditTab.find((tab) => tab.id != null)?.id ?? null;
}

async function buildLoginMessage(
  account: StoredAccount,
): Promise<Extract<LinchpinMessage, { type: 'linchpin:reddit-login' }>> {
  const username = account.username;
  const password = account.password;
  if (!username || !password) throw new Error('Add a Reddit username and password to this account');

  let otp: string | undefined;
  if (account.totpSecret) {
    let totp = await generateTotp(account.totpSecret);
    // Do not submit a code that will expire while Reddit is processing the request.
    if (totp.remaining <= 3) {
      await new Promise((resolve) => setTimeout(resolve, totp.remaining * 1_000 + 150));
      totp = await generateTotp(account.totpSecret);
    }
    otp = totp.code;
  }
  return { type: 'linchpin:reddit-login', username, password, otp };
}

async function requestRedditLogin(
  account: StoredAccount,
  tabId: number,
): Promise<RedditLoginResult> {
  const message = await buildLoginMessage(account);
  try {
    return (await browser.tabs.sendMessage(tabId, message)) as RedditLoginResult;
  } catch {
    return {
      ok: false,
      error: 'Could not reach the Reddit tab. Reload Reddit and try again.',
    };
  }
}

async function reloadRedditTabs(): Promise<number> {
  const tabs = await browser.tabs.query({ url: REDDIT_TAB_URLS });
  let count = 0;
  for (const tab of tabs) {
    if (tab.id == null) continue;
    try {
      await browser.tabs.reload(tab.id);
      count++;
    } catch {
      // A tab may close between query and reload.
    }
  }
  return count;
}

/** Authenticate through a Reddit tab, matching RES's same-origin account-switch flow. */
export async function switchToAccount(
  accountId: string,
  preferredTabId?: number,
): Promise<SwitchResult> {
  return withAccountSwitchLock(async () => {
    const store = await getAccountStore();
    const account = store.accounts.find((candidate) => candidate.id === accountId);
    if (!account) {
      return { ok: false, accountId, tabsReloaded: 0, message: 'Account not found' };
    }
    if (!account.username || !account.password) {
      return {
        ok: false,
        accountId,
        tabsReloaded: 0,
        message: 'Edit this account and add its Reddit username and password',
      };
    }

    const tabId = await findRedditTab(preferredTabId);
    if (tabId == null) {
      return {
        ok: false,
        accountId,
        tabsReloaded: 0,
        message: 'Open Reddit in a tab before switching accounts',
      };
    }

    const result = await requestRedditLogin(account, tabId);
    if (!result.ok) {
      account.sessionStatus = 'expired';
      store.activeAccountId = null;
      await saveAccountStore(store);
      return {
        ok: false,
        accountId,
        tabsReloaded: 0,
        message: result.error,
      };
    }

    for (const candidate of store.accounts) {
      candidate.sessionStatus =
        candidate.id === accountId ? 'active' : candidate.password ? 'saved' : 'unknown';
    }
    account.lastSwitchedAt = Date.now();
    account.savedAt = Date.now();
    store.activeAccountId = accountId;
    await saveAccountStore(store);
    const tabsReloaded = await reloadRedditTabs();
    return {
      ok: true,
      accountId,
      tabsReloaded,
      message: `Switched to “${account.label}” (${tabsReloaded} Reddit tabs reloaded)`,
    };
  });
}
