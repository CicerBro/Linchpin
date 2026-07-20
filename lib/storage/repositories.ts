import type { StorageMutationMessage } from '../core/messages';
import type {
  AccountStore,
  FeatureSettings,
  StoredAccount,
  SubredditVisitMap,
  ThreadVisit,
  ThreadVisitMap,
  UserTag,
  UserTagMap,
} from '../types';
import { mergeSettings, normalizeSettings } from './migrations';
import {
  accountsItem,
  MAX_SUBREDDIT_VISITS,
  MAX_THREAD_VISITS,
  settingsItem,
  subredditVisitsItem,
  tagsItem,
  threadVisitsItem,
} from './schema';

let mutationTail: Promise<unknown> = Promise.resolve();

function serialize<T>(operation: () => Promise<T>): Promise<T> {
  const result = mutationTail.then(operation, operation);
  mutationTail = result.then(() => undefined, () => undefined);
  return result;
}

export function normalizeUsername(raw: string): string {
  return raw.trim().replace(/^u\//i, '').replace(/^\/?(user|u)\//i, '').toLowerCase();
}

export function normalizeSubreddit(raw: string): string {
  return raw.trim().replace(/^r\//i, '').replace(/^\/?r\//i, '').toLowerCase();
}

function finiteInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(-2_147_483_648, Math.min(2_147_483_647, Math.trunc(value)))
    : undefined;
}

export function isSafeColor(value: string): boolean {
  const color = value.trim();
  if (!color || color.length > 100 || /[<>"'`;{}]/.test(color)) return false;
  if (typeof CSS !== 'undefined' && typeof CSS.supports === 'function') {
    return CSS.supports('color', color);
  }
  return /^(#[0-9a-f]{3,8}|(?:rgb|hsl)a?\([\d\s.,%+\-/]+\)|[a-z]+)$/i.test(color);
}

function safeLink(value: string): string | undefined {
  if (!value || value.length > 2_048 || /[<>"']/.test(value)) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}

export function sanitizeUserTag(raw: Partial<UserTag>, fallbackUsername = ''): UserTag {
  const username = normalizeUsername(raw.username || fallbackUsername);
  if (!username || username.length > 64 || !/^[a-z0-9_-]+$/i.test(username)) {
    throw new Error('Invalid tag username');
  }
  const tag: UserTag = {
    username,
    updatedAt:
      typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt)
        ? raw.updatedAt
        : Date.now(),
  };
  if (raw.label != null) {
    if (typeof raw.label !== 'string' || raw.label.length > 200 || /[<>]/.test(raw.label)) {
      throw new Error(`Invalid label for u/${username}`);
    }
    if (raw.label.trim()) tag.label = raw.label.trim();
  }
  if (raw.color != null) {
    if (typeof raw.color !== 'string') {
      throw new Error(`Invalid color for u/${username}`);
    }
    if (raw.color.trim()) {
      if (!isSafeColor(raw.color)) throw new Error(`Invalid color for u/${username}`);
      tag.color = raw.color.trim();
    }
  }
  if (raw.link != null) {
    if (typeof raw.link !== 'string') throw new Error(`Invalid link for u/${username}`);
    if (raw.link.trim()) {
      const link = safeLink(raw.link);
      if (!link) throw new Error(`Tag link for u/${username} must use http or https`);
      tag.link = link;
    }
  }
  if (raw.ignore === true) tag.ignore = true;
  const votesUp = finiteInteger(raw.votesUp);
  const votesDown = finiteInteger(raw.votesDown);
  if (votesUp != null) tag.votesUp = votesUp;
  if (votesDown != null) tag.votesDown = votesDown;
  return tag;
}

function equal(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function pruneSubreddits(visits: SubredditVisitMap): SubredditVisitMap {
  return Object.fromEntries(
    Object.entries(visits)
      .filter(([, stamp]) => Number.isFinite(stamp))
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_SUBREDDIT_VISITS),
  );
}

function pruneThreads(visits: ThreadVisitMap): ThreadVisitMap {
  return Object.fromEntries(
    Object.entries(visits)
      .filter(([, visit]) => Number.isFinite(visit.visitedAt))
      .sort((a, b) => b[1].visitedAt - a[1].visitedAt)
      .slice(0, MAX_THREAD_VISITS),
  );
}

export async function pruneVisitHistory(): Promise<void> {
  await serialize(async () => {
    const subreddits = await subredditVisitsItem.getValue();
    const threads = await threadVisitsItem.getValue();
    const nextSubreddits = pruneSubreddits(subreddits);
    const nextThreads = pruneThreads(threads);
    if (!equal(subreddits, nextSubreddits)) await subredditVisitsItem.setValue(nextSubreddits);
    if (!equal(threads, nextThreads)) await threadVisitsItem.setValue(nextThreads);
  });
}

export async function executeStorageMutation(message: StorageMutationMessage): Promise<unknown> {
  return serialize(async () => {
    switch (message.operation) {
      case 'upsert-tag': {
        const tags = await tagsItem.getValue();
        const key = normalizeUsername(message.value.username);
        const merged = sanitizeUserTag({
          ...tags[key],
          ...message.value,
          username: key,
          updatedAt: message.value.updatedAt ?? Date.now(),
        });
        if (!equal(tags[key], merged)) await tagsItem.setValue({ ...tags, [key]: merged });
        return merged;
      }
      case 'delete-tag': {
        const tags = await tagsItem.getValue();
        const key = normalizeUsername(message.username);
        if (!(key in tags)) return undefined;
        const next = { ...tags };
        delete next[key];
        await tagsItem.setValue(next);
        return undefined;
      }
      case 'merge-tags': {
        const current = await tagsItem.getValue();
        const next = { ...current };
        let added = 0;
        let updated = 0;
        let skipped = 0;
        for (const [rawKey, rawTag] of Object.entries(message.value)) {
          const incoming = sanitizeUserTag(rawTag, rawKey);
          const existing = next[incoming.username];
          if (!existing) {
            next[incoming.username] = incoming;
            added++;
            continue;
          }
          const candidate = message.overwrite
            ? sanitizeUserTag({ ...existing, ...incoming, updatedAt: existing.updatedAt }, incoming.username)
            : sanitizeUserTag({ ...incoming, ...existing, updatedAt: existing.updatedAt }, incoming.username);
          if (equal(existing, candidate)) {
            skipped++;
            continue;
          }
          candidate.updatedAt = Date.now();
          next[incoming.username] = candidate;
          updated++;
        }
        if (added || updated) await tagsItem.setValue(next);
        return { added, updated, skipped };
      }
      case 'update-settings': {
        const current = normalizeSettings(await settingsItem.getValue());
        const next = mergeSettings(current, message.value);
        if (!equal(current, next)) await settingsItem.setValue(next);
        return next;
      }
      case 'replace-settings': {
        const next = normalizeSettings(message.value);
        const current = normalizeSettings(await settingsItem.getValue());
        if (!equal(current, next)) await settingsItem.setValue(next);
        return next;
      }
      case 'save-accounts':
        await accountsItem.setValue(message.value);
        return undefined;
      case 'upsert-account': {
        const store = await accountsItem.getValue();
        const index = store.accounts.findIndex((account) => account.id === message.value.id);
        const accounts = [...store.accounts];
        if (index >= 0) accounts[index] = message.value;
        else accounts.push(message.value);
        const next = { ...store, accounts };
        await accountsItem.setValue(next);
        return next;
      }
      case 'remove-account': {
        const store = await accountsItem.getValue();
        if (!store.accounts.some((account) => account.id === message.id)) return store;
        const next: AccountStore = {
          accounts: store.accounts.filter((account) => account.id !== message.id),
          activeAccountId: store.activeAccountId === message.id ? null : store.activeAccountId,
        };
        await accountsItem.setValue(next);
        return next;
      }
      case 'set-active-account': {
        const store = await accountsItem.getValue();
        if (store.activeAccountId === message.id) return store;
        const next = { ...store, activeAccountId: message.id };
        await accountsItem.setValue(next);
        return next;
      }
      case 'record-subreddit': {
        const key = normalizeSubreddit(message.name);
        if (!key) return undefined;
        const current = await subredditVisitsItem.getValue();
        await subredditVisitsItem.setValue(pruneSubreddits({ ...current, [key]: Date.now() }));
        return undefined;
      }
      case 'record-thread': {
        const key = message.fullname.toLowerCase();
        if (!key) return undefined;
        const current = await threadVisitsItem.getValue();
        const visit: ThreadVisit = {
          fullname: key,
          commentCount: Math.max(0, Math.trunc(message.commentCount)),
          visitedAt: Date.now(),
          path: message.path,
        };
        await threadVisitsItem.setValue(pruneThreads({ ...current, [key]: visit }));
        return undefined;
      }
      case 'merge-subreddits': {
        const current = await subredditVisitsItem.getValue();
        const next = { ...current };
        let added = 0;
        let updated = 0;
        for (const [rawName, stamp] of Object.entries(message.value)) {
          const name = normalizeSubreddit(rawName);
          if (!name || !Number.isFinite(stamp)) continue;
          if (next[name] == null) {
            next[name] = stamp;
            added++;
          } else if (stamp > next[name]) {
            next[name] = stamp;
            updated++;
          }
        }
        if (added || updated) await subredditVisitsItem.setValue(pruneSubreddits(next));
        return { added, updated };
      }
      case 'merge-threads': {
        const current = await threadVisitsItem.getValue();
        const next = { ...current };
        let added = 0;
        let updated = 0;
        for (const [rawKey, visit] of Object.entries(message.value)) {
          const key = rawKey.toLowerCase();
          if (!key || !Number.isFinite(visit.visitedAt)) continue;
          const normalized = { ...visit, fullname: key };
          if (!next[key]) {
            next[key] = normalized;
            added++;
          } else if (visit.visitedAt > next[key].visitedAt) {
            next[key] = normalized;
            updated++;
          }
        }
        if (added || updated) await threadVisitsItem.setValue(pruneThreads(next));
        return { added, updated };
      }
    }
  });
}
