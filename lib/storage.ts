import type { StorageMutationMessage } from './core/messages';
import {
  DEFAULT_SETTINGS,
  type AccountRecoveryState,
  type AccountStore,
  type FeatureSettings,
  type SettingsPatch,
  type StoredAccount,
  type SubredditVisitMap,
  type ThreadVisitMap,
  type UserTag,
  type UserTagMap,
} from './types';
import { migrateSettings, normalizeSettings } from './storage/migrations';
import {
  executeStorageMutation,
  normalizeSubreddit,
  normalizeUsername,
  pruneVisitHistory,
} from './storage/repositories';
import {
  accountRecoveryItem,
  accountsItem,
  settingsItem,
  subredditVisitsItem,
  tagsItem,
  threadVisitsItem,
} from './storage/schema';

export {
  accountRecoveryItem,
  accountsItem,
  normalizeSubreddit,
  normalizeUsername,
  settingsItem,
  subredditVisitsItem,
  tagsItem,
  threadVisitsItem,
};

async function mutate<T>(message: StorageMutationMessage): Promise<T> {
  // Service workers own the serialized queue; extension/content pages message it.
  if (typeof window === 'undefined') {
    return executeStorageMutation(message) as Promise<T>;
  }
  return browser.runtime.sendMessage(message) as Promise<T>;
}

export function isIgnoredTag(tag: UserTag | undefined): boolean {
  return Boolean(tag && (tag.ignore || (tag.label ?? '').trim().toLowerCase() === 'ignore'));
}

export async function initializeStorage(): Promise<void> {
  await migrateSettings();
  await pruneVisitHistory();
}

export async function getTags(): Promise<UserTagMap> {
  return tagsItem.getValue();
}

export async function getSettings(): Promise<FeatureSettings> {
  return normalizeSettings(await settingsItem.getValue());
}

export async function getAccountStore(): Promise<AccountStore> {
  return accountsItem.getValue();
}

export async function getAccountRecovery(): Promise<AccountRecoveryState | null> {
  return accountRecoveryItem.getValue();
}

export async function getSubredditVisits(): Promise<SubredditVisitMap> {
  return subredditVisitsItem.getValue();
}

export async function getThreadVisits(): Promise<ThreadVisitMap> {
  return threadVisitsItem.getValue();
}

export function upsertTag(
  value: Omit<UserTag, 'updatedAt'> & { updatedAt?: number },
): Promise<UserTag> {
  return mutate({ type: 'linchpin:storage', operation: 'upsert-tag', value });
}

export function deleteTag(username: string): Promise<void> {
  return mutate({ type: 'linchpin:storage', operation: 'delete-tag', username });
}

export function mergeTags(
  value: UserTagMap,
  options: { overwrite?: boolean } = {},
): Promise<{ added: number; updated: number; skipped: number }> {
  return mutate({
    type: 'linchpin:storage',
    operation: 'merge-tags',
    value,
    overwrite: options.overwrite ?? false,
  });
}

export function updateSettings(value: SettingsPatch): Promise<FeatureSettings> {
  return mutate({ type: 'linchpin:storage', operation: 'update-settings', value });
}

export function replaceSettings(value: FeatureSettings): Promise<FeatureSettings> {
  return mutate({ type: 'linchpin:storage', operation: 'replace-settings', value });
}

export function saveAccountStore(value: AccountStore): Promise<void> {
  return mutate({ type: 'linchpin:storage', operation: 'save-accounts', value });
}

export function upsertAccount(value: StoredAccount): Promise<AccountStore> {
  return mutate({ type: 'linchpin:storage', operation: 'upsert-account', value });
}

export function removeAccount(id: string): Promise<AccountStore> {
  return mutate({ type: 'linchpin:storage', operation: 'remove-account', id });
}

export function setActiveAccountId(id: string | null): Promise<AccountStore> {
  return mutate({ type: 'linchpin:storage', operation: 'set-active-account', id });
}

export function recordSubredditVisit(name: string): Promise<void> {
  return mutate({ type: 'linchpin:storage', operation: 'record-subreddit', name });
}

export function recordThreadVisit(
  fullname: string,
  commentCount: number,
  path?: string,
): Promise<void> {
  return mutate({
    type: 'linchpin:storage',
    operation: 'record-thread',
    fullname,
    commentCount,
    path,
  });
}

export function mergeSubredditVisits(
  value: SubredditVisitMap,
): Promise<{ added: number; updated: number }> {
  return mutate({ type: 'linchpin:storage', operation: 'merge-subreddits', value });
}

export function mergeThreadVisits(
  value: ThreadVisitMap,
): Promise<{ added: number; updated: number }> {
  return mutate({ type: 'linchpin:storage', operation: 'merge-threads', value });
}

/** Reddit-users-only export (labels, ignore, links, vote counts). Prefer buildLinchpinBackup for full backups. */
export function buildSafeExport(tags: UserTagMap): {
  source: string;
  exportedAt: string;
  reddit: { users: UserTagMap };
} {
  return {
    source: 'linchpin',
    exportedAt: new Date().toISOString(),
    reddit: { users: tags },
  };
}

/** Public account summary for UI lists (no secrets). */
export function accountPublicSummary(account: StoredAccount) {
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

export function watchSettings(cb: (settings: FeatureSettings) => void): () => void {
  return settingsItem.watch((value) => cb(normalizeSettings(value)));
}

export function watchAccounts(cb: (store: AccountStore) => void): () => void {
  return accountsItem.watch(cb);
}

export function watchSubredditVisits(cb: (visits: SubredditVisitMap) => void): () => void {
  return subredditVisitsItem.watch(cb);
}

export function watchThreadVisits(cb: (visits: ThreadVisitMap) => void): () => void {
  return threadVisitsItem.watch(cb);
}

export function newAccountId(): string {
  return `acct_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export { DEFAULT_SETTINGS };
