/*
 * Runtime behavior adapted from JSON Formatter v0.8.0 (27aa995) by Callum Locke.
 * Copyright (c) 2023, Callum Locke. BSD-3-Clause.
 * BSD-3-Clause notice and Linchpin changes: ./THIRD_PARTY_NOTICES.md
 */

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type ParsedJson = {
  value: JsonValue;
  hasUnsafeInteger: boolean;
};

/**
 * Scans numeric tokens without interpreting JSON a second time. This preserves
 * the one-JSON.parse invariant while warning about precision already lost by
 * the browser's native parser.
 */
function containsUnsafeIntegerToken(source: string): boolean {
  let inString = false;
  let escaped = false;
  const numberPattern = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;

  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char !== '-' && (char < '0' || char > '9')) continue;

    numberPattern.lastIndex = index;
    const match = numberPattern.exec(source);
    if (!match) continue;
    const token = match[0];
    const parsed = Number(token);
    if (Number.isInteger(parsed) && !Number.isSafeInteger(parsed)) return true;
    index += token.length - 1;
  }
  return false;
}

export function parseJsonOnce(source: string): ParsedJson | null {
  try {
    return {
      value: JSON.parse(source) as JsonValue,
      hasUnsafeInteger: containsUnsafeIntegerToken(source),
    };
  } catch {
    return null;
  }
}
