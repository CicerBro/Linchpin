import type { UserTag, UserTagMap } from '../types';
import { normalizeUsername } from '../storage';

/** Raw RES `tag.<username>` value shape */
export type ResTagValue = {
  text?: string;
  color?: string;
  ignore?: boolean;
  link?: string;
  votesUp?: number;
  votesDown?: number;
  [key: string]: unknown;
};

export type ResExportFile = {
  source?: string;
  exportedAt?: string;
  tags: Record<string, ResTagValue> | UserTagMap;
};

function isUserTagMap(value: unknown): value is UserTagMap {
  if (!value || typeof value !== 'object') return false;
  const entries = Object.values(value as Record<string, unknown>);
  if (!entries.length) return true;
  const sample = entries[0] as Record<string, unknown>;
  return typeof sample?.username === 'string' && typeof sample?.updatedAt === 'number';
}

export function resValueToUserTag(
  username: string,
  value: ResTagValue,
  updatedAt = Date.now(),
): UserTag {
  const name = normalizeUsername(username);
  const label = typeof value.text === 'string' ? value.text : undefined;
  const ignore =
    value.ignore === true ||
    (typeof label === 'string' && label.trim().toLowerCase() === 'ignore');

  const tag: UserTag = {
    username: name,
    updatedAt,
  };

  if (label) tag.label = label;
  if (typeof value.color === 'string' && value.color) tag.color = value.color;
  if (ignore) tag.ignore = true;
  if (typeof value.link === 'string' && value.link) tag.link = value.link;
  if (typeof value.votesUp === 'number') tag.votesUp = value.votesUp;
  if (typeof value.votesDown === 'number') tag.votesDown = value.votesDown;

  return tag;
}

/**
 * Parse RES export JSON (or Rivet export) into a UserTagMap.
 * Accepts:
 * - `{ tags: { "user": { text, color, ... } } }`
 * - `{ tags: { "user": UserTag } }`
 * - flat `{ "user": { text, ... } }` / `{ "tag.user": {...} }`
 */
export function parseResTagsJson(raw: unknown): UserTagMap {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid JSON: expected an object');
  }

  const root = raw as Record<string, unknown>;
  let source: Record<string, unknown>;

  if (root.tags && typeof root.tags === 'object') {
    source = root.tags as Record<string, unknown>;
  } else {
    source = root;
  }

  if (isUserTagMap(source)) {
    const out: UserTagMap = {};
    for (const [k, tag] of Object.entries(source)) {
      const name = normalizeUsername(tag.username || k);
      out[name] = { ...tag, username: name };
    }
    return out;
  }

  const out: UserTagMap = {};
  const now = Date.now();

  for (const [key, value] of Object.entries(source)) {
    if (!value || typeof value !== 'object') continue;
    let username = key;
    if (username.startsWith('tag.')) username = username.slice(4);
    // Skip RES option keys accidentally included
    if (username.startsWith('RES') || username.includes('.')) continue;
    out[normalizeUsername(username)] = resValueToUserTag(
      username,
      value as ResTagValue,
      now,
    );
  }

  return out;
}

export function parseResTagsText(text: string): UserTagMap {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Could not parse JSON');
  }
  return parseResTagsJson(parsed);
}
