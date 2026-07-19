import { storage } from 'wxt/utils/storage';
import {
  DEFAULT_ACCOUNT_STORE,
  DEFAULT_SETTINGS,
  type AccountStore,
  type Settings,
  type StoredAccount,
  type SubredditVisitMap,
  type ThreadVisitMap,
  type UserTag,
  type UserTagMap,
} from './types';

export const tagsItem = storage.defineItem<UserTagMap>('local:tags', {
  fallback: {},
});

export const settingsItem = storage.defineItem<Settings>('local:settings', {
  fallback: DEFAULT_SETTINGS,
});

export const accountsItem = storage.defineItem<AccountStore>('local:accounts', {
  fallback: DEFAULT_ACCOUNT_STORE,
});

export const subredditVisitsItem = storage.defineItem<SubredditVisitMap>(
  'local:subredditVisits',
  { fallback: {} },
);

export const threadVisitsItem = storage.defineItem<ThreadVisitMap>(
  'local:threadVisits',
  { fallback: {} },
);

export function normalizeUsername(raw: string): string {
  return raw
    .trim()
    .replace(/^u\//i, '')
    .replace(/^\/?(user|u)\//i, '')
    .toLowerCase();
}

export function normalizeSubreddit(raw: string): string {
  return raw
    .trim()
    .replace(/^r\//i, '')
    .replace(/^\/?r\//i, '')
    .toLowerCase();
}

export function isIgnoredTag(tag: UserTag | undefined): boolean {
  if (!tag) return false;
  if (tag.ignore) return true;
  return (tag.label ?? '').trim().toLowerCase() === 'ignore';
}

export async function getTags(): Promise<UserTagMap> {
  return tagsItem.getValue();
}

export async function getSettings(): Promise<Settings> {
  const stored = await settingsItem.getValue();
  return { ...DEFAULT_SETTINGS, ...stored };
}

export async function getAccountStore(): Promise<AccountStore> {
  return accountsItem.getValue();
}

export async function getSubredditVisits(): Promise<SubredditVisitMap> {
  return subredditVisitsItem.getValue();
}

export async function getThreadVisits(): Promise<ThreadVisitMap> {
  return threadVisitsItem.getValue();
}

export async function upsertTag(
  partial: Omit<UserTag, 'updatedAt'> & { updatedAt?: number },
): Promise<UserTag> {
  const username = normalizeUsername(partial.username);
  const tags = await getTags();
  const existing = tags[username];
  const next: UserTag = {
    ...existing,
    ...partial,
    username,
    updatedAt: partial.updatedAt ?? Date.now(),
  };

  if (!next.label) delete next.label;
  if (!next.color) delete next.color;
  if (!next.link) delete next.link;
  if (!next.ignore) delete next.ignore;

  tags[username] = next;
  await tagsItem.setValue(tags);
  return next;
}

export async function deleteTag(username: string): Promise<void> {
  const key = normalizeUsername(username);
  const tags = await getTags();
  if (!(key in tags)) return;
  delete tags[key];
  await tagsItem.setValue(tags);
}

export async function mergeTags(
  incoming: UserTagMap,
  options: { overwrite?: boolean } = {},
): Promise<{ added: number; updated: number; skipped: number }> {
  const overwrite = options.overwrite ?? false;
  const tags = await getTags();
  let added = 0;
  let updated = 0;
  let skipped = 0;

  for (const [rawKey, tag] of Object.entries(incoming)) {
    const key = normalizeUsername(tag.username || rawKey);
    const existing = tags[key];
    if (!existing) {
      tags[key] = { ...tag, username: key, updatedAt: tag.updatedAt || Date.now() };
      added++;
      continue;
    }
    if (!overwrite) {
      const merged: UserTag = {
        ...tag,
        ...existing,
        username: key,
        votesUp: existing.votesUp ?? tag.votesUp,
        votesDown: existing.votesDown ?? tag.votesDown,
        link: existing.link ?? tag.link,
        updatedAt: Date.now(),
      };
      if (!existing.label && tag.label) merged.label = tag.label;
      if (!existing.color && tag.color) merged.color = tag.color;
      if (existing.ignore == null && tag.ignore) merged.ignore = tag.ignore;
      tags[key] = merged;
      updated++;
    } else {
      tags[key] = {
        ...existing,
        ...tag,
        username: key,
        updatedAt: Date.now(),
      };
      updated++;
    }
  }

  await tagsItem.setValue(tags);
  return { added, updated, skipped };
}

export async function updateSettings(
  patch: Partial<Settings>,
): Promise<Settings> {
  const current = await getSettings();
  const next = { ...current, ...patch };
  await settingsItem.setValue(next);
  return next;
}

export async function saveAccountStore(store: AccountStore): Promise<void> {
  await accountsItem.setValue(store);
}

export async function upsertAccount(
  account: StoredAccount,
): Promise<AccountStore> {
  const store = await getAccountStore();
  const idx = store.accounts.findIndex((a) => a.id === account.id);
  if (idx >= 0) store.accounts[idx] = account;
  else store.accounts.push(account);
  await saveAccountStore(store);
  return store;
}

export async function removeAccount(id: string): Promise<AccountStore> {
  const store = await getAccountStore();
  store.accounts = store.accounts.filter((a) => a.id !== id);
  if (store.activeAccountId === id) store.activeAccountId = null;
  await saveAccountStore(store);
  return store;
}

export async function setActiveAccountId(id: string | null): Promise<AccountStore> {
  const store = await getAccountStore();
  store.activeAccountId = id;
  await saveAccountStore(store);
  return store;
}

export async function recordSubredditVisit(name: string): Promise<void> {
  const key = normalizeSubreddit(name);
  if (!key) return;
  const visits = await getSubredditVisits();
  visits[key] = Date.now();
  await subredditVisitsItem.setValue(visits);
}

export async function recordThreadVisit(
  fullname: string,
  commentCount: number,
  path?: string,
): Promise<void> {
  const key = fullname.toLowerCase();
  if (!key) return;
  const visits = await getThreadVisits();
  visits[key] = {
    fullname: key,
    commentCount,
    visitedAt: Date.now(),
    path,
  };
  await threadVisitsItem.setValue(visits);
}

/** @deprecated Prefer buildRivetBackup — tags-only helper kept for callers. */
export function buildSafeExport(tags: UserTagMap): {
  source: string;
  exportedAt: string;
  tags: UserTagMap;
} {
  return {
    source: 'rivet',
    exportedAt: new Date().toISOString(),
    tags,
  };
}

/** Merge visit maps; keep the newer stamp per key. */
export async function mergeSubredditVisits(
  incoming: SubredditVisitMap,
): Promise<{ added: number; updated: number }> {
  const current = await getSubredditVisits();
  let added = 0;
  let updated = 0;
  for (const [key, ts] of Object.entries(incoming)) {
    const name = normalizeSubreddit(key);
    if (!name) continue;
    const prev = current[name];
    if (prev == null) {
      current[name] = ts;
      added++;
    } else if (ts > prev) {
      current[name] = ts;
      updated++;
    }
  }
  await subredditVisitsItem.setValue(current);
  return { added, updated };
}

export async function mergeThreadVisits(
  incoming: ThreadVisitMap,
): Promise<{ added: number; updated: number }> {
  const current = await getThreadVisits();
  let added = 0;
  let updated = 0;
  for (const [key, visit] of Object.entries(incoming)) {
    const fullname = key.toLowerCase();
    if (!fullname) continue;
    const prev = current[fullname];
    if (!prev) {
      current[fullname] = { ...visit, fullname };
      added++;
    } else if (visit.visitedAt > prev.visitedAt) {
      current[fullname] = { ...visit, fullname };
      updated++;
    }
  }
  await threadVisitsItem.setValue(current);
  return { added, updated };
}

export async function replaceSettings(next: Settings): Promise<Settings> {
  await settingsItem.setValue(next);
  return next;
}

/** Public account summary for UI lists (no secrets). */
export function accountPublicSummary(account: StoredAccount): {
  id: string;
  label: string;
  username?: string;
  sessionStatus: StoredAccount['sessionStatus'];
  hasCookies: boolean;
  hasTotp: boolean;
  savedAt?: number;
  lastSwitchedAt?: number;
} {
  return {
    id: account.id,
    label: account.label,
    username: account.username,
    sessionStatus: account.sessionStatus,
    hasCookies: account.cookies.length > 0,
    hasTotp: Boolean(account.totpSecret),
    savedAt: account.savedAt,
    lastSwitchedAt: account.lastSwitchedAt,
  };
}

export function watchTags(cb: (tags: UserTagMap) => void): () => void {
  return tagsItem.watch(cb);
}

export function watchSettings(cb: (settings: Settings) => void): () => void {
  return settingsItem.watch(cb);
}

export function watchAccounts(cb: (store: AccountStore) => void): () => void {
  return accountsItem.watch(cb);
}

export function watchSubredditVisits(
  cb: (visits: SubredditVisitMap) => void,
): () => void {
  return subredditVisitsItem.watch(cb);
}

export function watchThreadVisits(
  cb: (visits: ThreadVisitMap) => void,
): () => void {
  return threadVisitsItem.watch(cb);
}

export function newAccountId(): string {
  return `acct_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
