/*
 * Runtime behavior adapted from JSON Formatter master (bfd6356) by Callum Locke.
 * Copyright (c) 2023, Callum Locke. BSD-3-Clause.
 * BSD-3-Clause notice and Linchpin changes: ./THIRD_PARTY_NOTICES.md
 */

export const MAX_JSON_SOURCE_LENGTH = 10 * 1024 * 1024;

function isJsonContentType(contentType: string): boolean {
  const mime = contentType.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  return mime === 'application/json' || /^application\/[a-z0-9!#$&^_.+-]+\+json$/.test(mime);
}

function simplePreSource(doc: Document): string | null {
  const body = doc.body;
  if (!body || body.children.length !== 1) return null;
  const pre = body.firstElementChild;
  if (!(pre instanceof HTMLPreElement)) return null;
  const source = pre.textContent ?? '';
  const first = source.trimStart()[0];
  return first === '{' || first === '[' ? source : null;
}

/** Returns the untouched response text, or null with no DOM changes. */
export function detectJsonSource(
  doc: Document,
  maxLength = MAX_JSON_SOURCE_LENGTH,
): string | null {
  const source = isJsonContentType(doc.contentType)
    ? doc.body?.textContent ?? doc.documentElement.textContent ?? ''
    : simplePreSource(doc);

  if (source == null || source.length === 0 || source.length > maxLength) return null;
  return source;
}
