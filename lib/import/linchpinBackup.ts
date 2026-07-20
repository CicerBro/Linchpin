import type {
  Settings,
  SubredditVisitMap,
  ThreadVisit,
  ThreadVisitMap,
  UserTagMap,
} from '../types';
import { parseResTagsJson } from './resTags';
import { normalizeSettings } from '../storage/migrations';

export const LINCHPIN_BACKUP_VERSION = 2 as const;

/** Reddit-scoped portable data (users include labels, ignore, links, and vote counts). */
export type LinchpinBackupReddit = {
  users?: UserTagMap;
  subredditVisits?: SubredditVisitMap;
  threadVisits?: ThreadVisitMap;
};

/** Safe Linchpin backup — never includes accounts, cookies, or TOTP secrets. */
export type LinchpinBackup = {
  source: 'linchpin';
  version: typeof LINCHPIN_BACKUP_VERSION;
  exportedAt: string;
  settings?: Settings;
  reddit?: LinchpinBackupReddit;
};

export type ParsedBackup = {
  settings?: Settings;
  tags?: UserTagMap;
  subredditVisits?: SubredditVisitMap;
  threadVisits?: ThreadVisitMap;
  /** True when the file claimed to contain accounts (ignored). */
  ignoredAccounts: boolean;
};

const LEGACY_SETTINGS_KEYS = [
  'enableTags',
  'enableIgnore',
  'enableOldRedditInfiniteScroll',
  'enableSubredditLastVisited',
  'enableNewCommentCounts',
  'tagBadgeStyle',
];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function parseSettingsPartial(raw: unknown): Settings | undefined {
  if (!isPlainObject(raw)) return undefined;
  const touched =
    ['reddit', 'jsonFormatter', 'google', 'youtube', 'summarizer'].some((key) => key in raw) ||
    LEGACY_SETTINGS_KEYS.some((key) => key in raw);
  return touched ? normalizeSettings(raw) : undefined;
}

function parseSubredditVisits(raw: unknown): SubredditVisitMap | undefined {
  if (!isPlainObject(raw)) return undefined;
  const out: SubredditVisitMap = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    const name = key.trim().toLowerCase();
    if (!name) continue;
    out[name] = value;
  }
  return Object.keys(out).length ? out : undefined;
}

function parseThreadVisits(raw: unknown): ThreadVisitMap | undefined {
  if (!isPlainObject(raw)) return undefined;
  const out: ThreadVisitMap = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!isPlainObject(value)) continue;
    const fullname = String(value.fullname || key).toLowerCase();
    const commentCount = value.commentCount;
    const visitedAt = value.visitedAt;
    if (!fullname || typeof commentCount !== 'number' || typeof visitedAt !== 'number') {
      continue;
    }
    const visit: ThreadVisit = {
      fullname,
      commentCount,
      visitedAt,
    };
    if (typeof value.path === 'string') visit.path = value.path;
    out[fullname] = visit;
  }
  return Object.keys(out).length ? out : undefined;
}

function parseUsersMap(raw: unknown): UserTagMap | undefined {
  if (!isPlainObject(raw) || !Object.keys(raw).length) return undefined;
  try {
    const tags = parseResTagsJson({ tags: raw });
    return Object.keys(tags).length ? tags : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Parse Linchpin or RES JSON for import.
 * - Linchpin v2: settings + reddit.{users,subredditVisits,threadVisits}
 * - Linchpin v1: settings + root tags/subredditVisits/threadVisits
 * - Tags-only / RES: `{ tags: … }` or flat tag map
 * Accounts / cookies / TOTP are never imported.
 */
export function parseLinchpinBackupJson(raw: unknown): ParsedBackup {
  if (!isPlainObject(raw)) {
    throw new Error('Invalid JSON: expected an object');
  }

  const ignoredAccounts = 'accounts' in raw || 'accountStore' in raw;
  const settings = parseSettingsPartial(raw.settings);
  const reddit = isPlainObject(raw.reddit) ? raw.reddit : undefined;

  const subredditVisits =
    parseSubredditVisits(reddit?.subredditVisits) || parseSubredditVisits(raw.subredditVisits);
  const threadVisits =
    parseThreadVisits(reddit?.threadVisits) || parseThreadVisits(raw.threadVisits);

  let tags: UserTagMap | undefined = parseUsersMap(reddit?.users);
  try {
    if (!tags && ('tags' in raw || 'users' in raw || !('settings' in raw))) {
      if ('users' in raw && isPlainObject(raw.users)) {
        tags = parseUsersMap(raw.users);
      } else {
        tags = parseResTagsJson(raw);
        if (!Object.keys(tags).length) tags = undefined;
      }
    }
  } catch (err) {
    // Settings-only backups have no users — allow that when settings/visits exist
    if (!settings && !subredditVisits && !threadVisits) throw err;
  }

  if (!settings && !tags && !subredditVisits && !threadVisits) {
    throw new Error('Nothing to import: expected settings, Reddit users, and/or visit maps');
  }

  return { settings, tags, subredditVisits, threadVisits, ignoredAccounts };
}

export function parseLinchpinBackupText(text: string): ParsedBackup {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Could not parse JSON');
  }
  return parseLinchpinBackupJson(parsed);
}

export function buildLinchpinBackup(input: {
  tags: UserTagMap;
  settings: Settings;
  subredditVisits: SubredditVisitMap;
  threadVisits: ThreadVisitMap;
}): LinchpinBackup {
  return {
    source: 'linchpin',
    version: LINCHPIN_BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    settings: normalizeSettings(input.settings),
    reddit: {
      users: input.tags,
      subredditVisits: input.subredditVisits,
      threadVisits: input.threadVisits,
    },
  };
}
