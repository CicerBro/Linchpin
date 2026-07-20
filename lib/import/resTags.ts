import type { UserTag, UserTagMap } from '../types';
import { normalizeUsername } from '../storage';
import { sanitizeUserTag } from '../storage/repositories';

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

function plainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function optionalPrimitive(
  value: Record<string, unknown>,
  key: string,
  kind: 'string' | 'boolean' | 'number',
  username: string,
): void {
  if (value[key] != null && typeof value[key] !== kind) {
    throw new Error(`Invalid ${key} for u/${username}`);
  }
}

export function resValueToUserTag(
  username: string,
  value: ResTagValue,
  updatedAt = Date.now(),
): UserTag {
  const name = normalizeUsername(username);
  optionalPrimitive(value, 'text', 'string', name);
  optionalPrimitive(value, 'color', 'string', name);
  optionalPrimitive(value, 'ignore', 'boolean', name);
  optionalPrimitive(value, 'link', 'string', name);
  optionalPrimitive(value, 'votesUp', 'number', name);
  optionalPrimitive(value, 'votesDown', 'number', name);
  const label = typeof value.text === 'string' ? value.text : undefined;
  const ignore =
    value.ignore === true ||
    (typeof label === 'string' && label.trim().toLowerCase() === 'ignore');

  return sanitizeUserTag({
    username: name,
    updatedAt,
    label,
    color: typeof value.color === 'string' && value.color ? value.color : undefined,
    ignore,
    link: typeof value.link === 'string' && value.link ? value.link : undefined,
    votesUp: value.votesUp,
    votesDown: value.votesDown,
  });
}

/**
 * Parse RES export JSON (or a Linchpin export) into a UserTagMap.
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

  const out: UserTagMap = {};
  const now = Date.now();

  if (Object.keys(source).length > 100_000) {
    throw new Error('Tag import is too large');
  }

  for (const [key, value] of Object.entries(source)) {
    let username = key;
    if (username.startsWith('tag.')) username = username.slice(4);
    // Skip RES option keys accidentally included
    if (username.startsWith('RES') || username.includes('.')) continue;
    if (!plainObject(value)) throw new Error(`Invalid tag entry for u/${username}`);

    const isLinchpinTag = 'username' in value || 'updatedAt' in value;
    if (isLinchpinTag) {
      optionalPrimitive(value, 'username', 'string', username);
      optionalPrimitive(value, 'updatedAt', 'number', username);
      optionalPrimitive(value, 'label', 'string', username);
      optionalPrimitive(value, 'color', 'string', username);
      optionalPrimitive(value, 'ignore', 'boolean', username);
      optionalPrimitive(value, 'link', 'string', username);
      optionalPrimitive(value, 'votesUp', 'number', username);
      optionalPrimitive(value, 'votesDown', 'number', username);
      const tag = sanitizeUserTag(value as Partial<UserTag>, username);
      out[tag.username] = tag;
    } else {
      const tag = resValueToUserTag(username, value as ResTagValue, now);
      out[tag.username] = tag;
    }
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
