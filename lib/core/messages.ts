import type {
  AccountStore,
  FeatureSettings,
  SettingsPatch,
  StoredAccount,
  SubredditVisitMap,
  ThreadVisitMap,
  UserTag,
  UserTagMap,
} from '../types';

export type StorageMutationMessage =
  | {
      type: 'linchpin:storage';
      operation: 'upsert-tag';
      value: Omit<UserTag, 'updatedAt'> & { updatedAt?: number };
    }
  | { type: 'linchpin:storage'; operation: 'delete-tag'; username: string }
  | { type: 'linchpin:storage'; operation: 'merge-tags'; value: UserTagMap; overwrite: boolean }
  | { type: 'linchpin:storage'; operation: 'update-settings'; value: SettingsPatch }
  | { type: 'linchpin:storage'; operation: 'replace-settings'; value: FeatureSettings }
  | { type: 'linchpin:storage'; operation: 'save-accounts'; value: AccountStore }
  | { type: 'linchpin:storage'; operation: 'upsert-account'; value: StoredAccount }
  | { type: 'linchpin:storage'; operation: 'remove-account'; id: string }
  | { type: 'linchpin:storage'; operation: 'set-active-account'; id: string | null }
  | { type: 'linchpin:storage'; operation: 'record-subreddit'; name: string }
  | {
      type: 'linchpin:storage';
      operation: 'record-thread';
      fullname: string;
      commentCount: number;
      path?: string;
    }
  | { type: 'linchpin:storage'; operation: 'merge-subreddits'; value: SubredditVisitMap }
  | { type: 'linchpin:storage'; operation: 'merge-threads'; value: ThreadVisitMap };

export function isStorageMutationMessage(value: unknown): value is StorageMutationMessage {
  return Boolean(
    value &&
    typeof value === 'object' &&
    (value as { type?: unknown }).type === 'linchpin:storage' &&
    typeof (value as { operation?: unknown }).operation === 'string',
  );
}
