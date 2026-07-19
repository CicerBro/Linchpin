import type {
  Settings,
  SubredditVisitMap,
  ThreadVisit,
  ThreadVisitMap,
  UserTagMap,
} from '../types';
import { DEFAULT_SETTINGS } from '../types';
import { parseResTagsJson } from './resTags';

export const RIVET_BACKUP_VERSION = 1 as const;

/** Safe backup — never includes accounts, cookies, or TOTP secrets. */
export type RivetBackup = {
  source: 'rivet';
  version: typeof RIVET_BACKUP_VERSION;
  exportedAt: string;
  settings?: Settings;
  tags?: UserTagMap;
  subredditVisits?: SubredditVisitMap;
  threadVisits?: ThreadVisitMap;
};

export type ParsedBackup = {
  settings?: Settings;
  tags?: UserTagMap;
  subredditVisits?: SubredditVisitMap;
  threadVisits?: ThreadVisitMap;
  /** True when the file claimed to contain accounts (ignored). */
  ignoredAccounts: boolean;
};

const SETTINGS_KEYS: (keyof Settings)[] = [
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

  const next: Settings = { ...DEFAULT_SETTINGS };
  let touched = false;

  for (const key of SETTINGS_KEYS) {
    if (!(key in raw)) continue;
    const value = raw[key];
    if (key === 'tagBadgeStyle') {
      if (value === 'pill' || value === 'text') {
        next.tagBadgeStyle = value;
        touched = true;
      }
      continue;
    }
    if (typeof value === 'boolean') {
      next[key] = value;
      touched = true;
    }
  }

  return touched ? next : undefined;
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

/**
 * Parse Rivet / RES JSON for import.
 * - Rivet backup: settings + tags + optional visit maps
 * - Tags-only / RES: `{ tags: … }` or flat tag map
 * Accounts / cookies / TOTP are never imported.
 */
export function parseRivetBackupJson(raw: unknown): ParsedBackup {
  if (!isPlainObject(raw)) {
    throw new Error('Invalid JSON: expected an object');
  }

  const ignoredAccounts = 'accounts' in raw || 'accountStore' in raw;
  const settings = parseSettingsPartial(raw.settings);
  const subredditVisits = parseSubredditVisits(raw.subredditVisits);
  const threadVisits = parseThreadVisits(raw.threadVisits);

  let tags: UserTagMap | undefined;
  try {
    if ('tags' in raw || !('settings' in raw)) {
      tags = parseResTagsJson(raw);
      if (!Object.keys(tags).length) tags = undefined;
    }
  } catch (err) {
    // Settings-only backups have no tags — allow that when settings/visits exist
    if (!settings && !subredditVisits && !threadVisits) throw err;
  }

  if (!settings && !tags && !subredditVisits && !threadVisits) {
    throw new Error(
      'Nothing to import: expected settings, tags, and/or visit maps',
    );
  }

  return { settings, tags, subredditVisits, threadVisits, ignoredAccounts };
}

export function parseRivetBackupText(text: string): ParsedBackup {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Could not parse JSON');
  }
  return parseRivetBackupJson(parsed);
}

export function buildRivetBackup(input: {
  tags: UserTagMap;
  settings: Settings;
  subredditVisits: SubredditVisitMap;
  threadVisits: ThreadVisitMap;
}): RivetBackup {
  return {
    source: 'rivet',
    version: RIVET_BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    settings: input.settings,
    tags: input.tags,
    subredditVisits: input.subredditVisits,
    threadVisits: input.threadVisits,
  };
}
