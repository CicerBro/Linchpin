import type { ExtractedPage } from './types';

export const MAX_SUMMARY_CHARACTERS = 80_000;

function normalizePageLanguage(raw?: string | null): string | undefined {
  const language = raw?.trim();
  return language ? language.toUpperCase().slice(0, 64) : undefined;
}

type ReadabilityArticle = {
  title?: string;
  byline?: string;
  excerpt?: string;
  textContent?: string;
  lang?: string;
  siteName?: string;
};

type ReadabilityModule = {
  Readability: new (
    document: Document,
    options?: { maxElemsToParse?: number },
  ) => { parse(): ReadabilityArticle | null };
};

/**
 * Loaded only when the user opens the summary page and requests extraction.
 */
export async function extractWithOptionalReadability(
  source: Document,
): Promise<ReadabilityArticle | null> {
  try {
    const module = (await import('@mozilla/readability')) as ReadabilityModule;
    const clone = source.cloneNode(true) as Document;
    // The lightweight isProbablyReaderable heuristic explicitly permits false
    // negatives. Extraction is user-triggered, so try the full parser directly.
    return new module.Readability(clone, { maxElemsToParse: 100_000 }).parse();
  } catch {
    return null;
  }
}

/** Runs Readability against the live page clone inside the isolated content script. */
export async function extractLivePageForSummary(): Promise<ExtractedPage | null> {
  const fallback = (): ExtractedPage | null => {
    const result = extractPageForSummary();
    return result.content ? result : null;
  };
  const selected = getSelection()?.toString().trim() || '';
  if (selected.length >= 80) return fallback();

  const article = await extractWithOptionalReadability(document);
  const text = article?.textContent
    ?.replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!text) return fallback();

  const description =
    document.querySelector<HTMLMetaElement>('meta[name="description"]')?.content ||
    document.querySelector<HTMLMetaElement>('meta[property="og:description"]')?.content;
  const pageTitle = document.title || location.hostname || 'Untitled page';
  return {
    title: (article?.title?.trim() || pageTitle).slice(0, 1000),
    url: location.href.slice(0, 4096),
    site: (article?.siteName?.trim() || location.hostname.replace(/^www\./, '')).slice(0, 255),
    byline: (
      article?.byline?.trim() ||
      document.querySelector<HTMLMetaElement>('meta[name="author"]')?.content
    )?.slice(0, 500),
    language: normalizePageLanguage(article?.lang || document.documentElement.lang),
    excerpt: (article?.excerpt?.trim() || description)?.slice(0, 1000),
    content: text.slice(0, MAX_SUMMARY_CHARACTERS),
    originalLength: text.length,
    truncated: text.length > MAX_SUMMARY_CHARACTERS,
  };
}

export type PageSnapshot = {
  html: string;
  selectedText: string;
  structuredText?: string;
  structuredOriginalLength?: number;
  title: string;
  url: string;
  site: string;
  byline?: string;
  language?: string;
  excerpt?: string;
};

/** Self-contained snapshot capture suitable for browser.scripting. */
export function capturePageSnapshot(): PageSnapshot {
  const maxCharacters = 80_000;
  const normalize = (value: string): string =>
    value
      .replace(/\r/g, '')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  const description =
    document.querySelector<HTMLMetaElement>('meta[name="description"]')?.content ||
    document.querySelector<HTMLMetaElement>('meta[property="og:description"]')?.content;
  const structuredBodies: string[] = [];
  let visitedStructuredValues = 0;
  const visitStructuredValue = (value: unknown): void => {
    if (visitedStructuredValues++ > 10_000 || !value) return;
    if (Array.isArray(value)) {
      for (const item of value) visitStructuredValue(item);
      return;
    }
    if (typeof value !== 'object') return;
    const record = value as Record<string, unknown>;
    if (typeof record.articleBody === 'string') {
      const body = normalize(record.articleBody);
      if (body.length >= 80) structuredBodies.push(body);
    }
    for (const child of Object.values(record)) visitStructuredValue(child);
  };
  for (const script of document.querySelectorAll<HTMLScriptElement>(
    'script[type="application/ld+json"]',
  )) {
    try {
      visitStructuredValue(JSON.parse(script.textContent || ''));
    } catch {
      // Ignore malformed third-party structured data.
    }
  }
  const structuredText = structuredBodies.sort((a, b) => b.length - a.length)[0];
  const html = document.documentElement.outerHTML;
  return {
    // Bound transfer/memory. Oversized snapshots use the in-tab fallback below.
    html: html.length <= 4_000_000 ? html : '',
    selectedText: normalize(getSelection()?.toString() || '').slice(0, maxCharacters),
    structuredText: structuredText?.slice(0, maxCharacters),
    structuredOriginalLength: structuredText?.length,
    title: normalize(document.title || location.hostname || 'Untitled page').slice(0, 1000),
    url: location.href.slice(0, 4096),
    site: location.hostname.replace(/^www\./, '').slice(0, 255),
    byline: document.querySelector<HTMLMetaElement>('meta[name="author"]')?.content?.slice(0, 500),
    language: normalizePageLanguage(document.documentElement.lang),
    excerpt: description?.slice(0, 1000),
  };
}

export async function extractSnapshotWithReadability(
  snapshot: PageSnapshot,
): Promise<ExtractedPage | null> {
  if (snapshot.selectedText.length >= 80) {
    return {
      ...snapshot,
      content: snapshot.selectedText,
      originalLength: snapshot.selectedText.length,
      truncated: false,
    };
  }
  if (!snapshot.html && snapshot.structuredText) {
    return {
      ...snapshot,
      content: snapshot.structuredText,
      originalLength: snapshot.structuredOriginalLength || snapshot.structuredText.length,
      truncated:
        (snapshot.structuredOriginalLength || snapshot.structuredText.length) >
        snapshot.structuredText.length,
    };
  }
  if (!snapshot.html) return null;
  const parsed = new DOMParser().parseFromString(snapshot.html, 'text/html');
  const base = parsed.createElement('base');
  base.href = snapshot.url;
  parsed.head.prepend(base);
  const article = await extractWithOptionalReadability(parsed);
  const text = article?.textContent
    ?.replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const contentText = text || snapshot.structuredText;
  if (!contentText) return null;
  return {
    title: article?.title?.trim().slice(0, 1000) || snapshot.title,
    url: snapshot.url,
    site: snapshot.site,
    byline: article?.byline?.trim().slice(0, 500) || snapshot.byline,
    language: normalizePageLanguage(article?.lang || snapshot.language),
    excerpt: article?.excerpt?.trim().slice(0, 1000) || snapshot.excerpt,
    content: contentText.slice(0, MAX_SUMMARY_CHARACTERS),
    originalLength: text ? text.length : snapshot.structuredOriginalLength || contentText.length,
    truncated: text
      ? text.length > MAX_SUMMARY_CHARACTERS
      : (snapshot.structuredOriginalLength || contentText.length) > contentText.length,
  };
}

/** Self-contained active-tab fallback suitable for browser.scripting. */
export function extractPageForSummary(): ExtractedPage {
  const MAX_CHARS = 80_000;
  const normalize = (value: string): string =>
    value
      .replace(/\r/g, '')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  const safeUrl = location.href.slice(0, 4096);
  const site = location.hostname.replace(/^www\./, '').slice(0, 255);
  const selected = normalize(getSelection()?.toString() || '');
  let text = '';
  let byline = '';
  let excerpt = '';

  if (selected.length >= 80) {
    text = selected;
  } else {
    const structuredBodies: string[] = [];
    let visitedStructuredValues = 0;
    const visitStructuredValue = (value: unknown): void => {
      if (visitedStructuredValues++ > 10_000 || !value) return;
      if (Array.isArray(value)) {
        for (const item of value) visitStructuredValue(item);
        return;
      }
      if (typeof value !== 'object') return;
      const record = value as Record<string, unknown>;
      if (typeof record.articleBody === 'string') {
        const body = normalize(record.articleBody);
        if (body.length >= 80) structuredBodies.push(body);
      }
      for (const child of Object.values(record)) visitStructuredValue(child);
    };
    for (const script of document.querySelectorAll<HTMLScriptElement>(
      'script[type="application/ld+json"]',
    )) {
      try {
        visitStructuredValue(JSON.parse(script.textContent || ''));
      } catch {
        // Ignore malformed third-party structured data.
      }
    }
    text = structuredBodies.sort((a, b) => b.length - a.length)[0] || '';

    const source =
      document.querySelector('article') ?? document.querySelector('main') ?? document.body;
    const excluded = [
      'script',
      'style',
      'noscript',
      'template',
      'svg',
      'canvas',
      'nav',
      'header',
      'footer',
      'aside',
      'form',
      'dialog',
      '[hidden]',
      '[aria-hidden="true"]',
      '[inert]',
      '[role="navigation"]',
      '[role="banner"]',
      '[role="dialog"]',
      '[class*="cookie" i]',
      '[id*="cookie" i]',
      '[class*="consent" i]',
      '[id*="consent" i]',
      '[data-linchpin-ui]',
    ].join(',');
    if (!text) {
      const walker = document.createTreeWalker(source, NodeFilter.SHOW_TEXT);
      const chunks: string[] = [];
      let node: Node | null;
      let visited = 0;
      let length = 0;
      while ((node = walker.nextNode()) && visited < 50_000 && length < MAX_CHARS) {
        visited++;
        const parent = node.parentElement;
        if (!parent || parent.closest(excluded)) continue;
        const style = getComputedStyle(parent);
        if (
          style.display === 'none' ||
          style.visibility === 'hidden' ||
          Number.parseFloat(style.opacity || '1') === 0
        )
          continue;
        const value = normalize(node.textContent || '');
        if (!value) continue;
        chunks.push(value);
        length += value.length + 1;
      }
      text = normalize(chunks.join('\n'));
    }
  }

  const author = document.querySelector<HTMLMetaElement>('meta[name="author"]')?.content;
  if (author) byline = normalize(author).slice(0, 500);
  const description =
    document.querySelector<HTMLMetaElement>('meta[name="description"]')?.content ||
    document.querySelector<HTMLMetaElement>('meta[property="og:description"]')?.content;
  if (description) excerpt = normalize(description).slice(0, 1000);

  const originalLength = text.length;
  const content = text.slice(0, MAX_CHARS);
  return {
    title: normalize(document.title || site || 'Untitled page').slice(0, 1000),
    url: safeUrl,
    site,
    byline: byline || undefined,
    language: normalizePageLanguage(document.documentElement.lang),
    excerpt: excerpt || undefined,
    content,
    originalLength,
    truncated: originalLength > content.length,
  };
}
