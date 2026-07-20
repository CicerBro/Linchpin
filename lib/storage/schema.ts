import { storage } from 'wxt/utils/storage';
import {
  DEFAULT_ACCOUNT_STORE,
  DEFAULT_SETTINGS,
  type AccountRecoveryState,
  type AccountStore,
  type FeatureSettings,
  type LegacySettings,
  type SubredditVisitMap,
  type ThreadVisitMap,
  type UserTagMap,
} from '../types';

export const STORAGE_SCHEMA_VERSION = 4;
export const MAX_THREAD_VISITS = 5_000;
export const MAX_SUBREDDIT_VISITS = 2_000;

export const schemaVersionItem = storage.defineItem<number>('local:schemaVersion', {
  fallback: 0,
});
export const tagsItem = storage.defineItem<UserTagMap>('local:tags', { fallback: {} });
export const settingsItem = storage.defineItem<FeatureSettings | LegacySettings>('local:settings', {
  fallback: DEFAULT_SETTINGS,
});
export const accountsItem = storage.defineItem<AccountStore>('local:accounts', {
  fallback: DEFAULT_ACCOUNT_STORE,
});
export const accountRecoveryItem = storage.defineItem<AccountRecoveryState | null>(
  'local:accountRecovery',
  { fallback: null },
);
export const subredditVisitsItem = storage.defineItem<SubredditVisitMap>('local:subredditVisits', {
  fallback: {},
});
export const threadVisitsItem = storage.defineItem<ThreadVisitMap>('local:threadVisits', {
  fallback: {},
});
