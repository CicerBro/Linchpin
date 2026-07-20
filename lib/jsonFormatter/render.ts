/*
 * Tree behavior and visual conventions adapted from JSON Formatter master
 * (bfd6356) by Callum Locke. Copyright (c) 2023, Callum Locke.
 * BSD-3-Clause notice and changes: ./THIRD_PARTY_NOTICES.md
 */

import type { JsonTheme } from '../core/siteFeatureSettings';
import type { JsonValue } from './parse';
import type { JsonItemCountMode } from '../types';
import { JSON_FORMATTER_STYLES } from './styles';

type Container = JsonValue[] | { [key: string]: JsonValue };
type RowState = {
  value: Container;
  children: HTMLElement;
  toggle: HTMLButtonElement;
  materialized: boolean;
  expanded: boolean;
  resume: (() => void) | null;
};

const MATERIALIZE_CHUNK = 250;

function isContainer(value: JsonValue): value is Container {
  return value !== null && typeof value === 'object';
}

function count(value: Container): number {
  return Array.isArray(value) ? value.length : Object.keys(value).length;
}

function primitiveElement(value: Exclude<JsonValue, Container>): HTMLElement {
  const span = document.createElement('span');
  if (value === null) {
    span.className = 'rjf-value-null';
    span.textContent = 'null';
  } else if (typeof value === 'string') {
    span.className = 'rjf-value-string';
    const serialized = JSON.stringify(value);
    const visibleValue = serialized.slice(1, -1);
    let href: string | null = null;
    try {
      const url = new URL(value, location.href);
      if (url.protocol === 'http:' || url.protocol === 'https:') href = url.href;
    } catch {
      // Ordinary strings are rendered as text below.
    }
    span.append(document.createTextNode('"'));
    if (href && (/^https?:\/\//i.test(value) || value.startsWith('/'))) {
      const link = document.createElement('a');
      link.href = href;
      link.textContent = visibleValue;
      span.append(link);
    } else {
      span.append(document.createTextNode(visibleValue));
    }
    span.append(document.createTextNode('"'));
  } else {
    span.className = `rjf-value-${typeof value}`;
    span.textContent = String(value);
  }
  return span;
}

function scheduleWork(callback: () => void): number {
  if (document.visibilityState === 'hidden') {
    queueMicrotask(callback);
    return -1;
  }
  return requestAnimationFrame(callback);
}

export type JsonFormatterMount = {
  setTheme(theme: JsonTheme): void;
  unmount(): void;
};

export function mountJsonFormatter(options: {
  value: JsonValue;
  rawSource: string;
  hasUnsafeInteger: boolean;
  theme: JsonTheme;
  showArrayIndices: boolean;
  itemCountMode: JsonItemCountMode;
  itemCountThreshold: number;
}): JsonFormatterMount {
  const {
    value,
    rawSource,
    hasUnsafeInteger,
    theme,
    showArrayIndices,
    itemCountMode,
    itemCountThreshold,
  } = options;
  const states = new WeakMap<HTMLElement, RowState>();
  const pending: Array<() => void> = [];
  let scheduled = false;
  let scheduledFrame: number | null = null;
  let copyStatusTimer: number | null = null;
  let disposed = false;

  const enqueue = (work: () => void) => {
    if (disposed) return;
    pending.push(work);
    if (scheduled) return;
    scheduled = true;
    scheduledFrame = scheduleWork(() => {
      scheduledFrame = null;
      if (disposed) return;
      scheduled = false;
      for (let i = 0; i < MATERIALIZE_CHUNK && pending.length; i++) pending.shift()?.();
      if (pending.length) enqueue(() => undefined);
    });
  };

  const root = document.createElement('main');
  root.id = 'linchpin-json-formatter';
  const originalBodyNodes = [...document.body.childNodes];
  const style = document.createElement('style');
  style.id = 'linchpin-json-formatter-styles';
  style.textContent = JSON_FORMATTER_STYLES;

  const toolbar = document.createElement('nav');
  toolbar.className = 'rjf-toolbar';
  toolbar.setAttribute('aria-label', 'JSON formatter controls');
  const controls: Array<[string, string]> = [
    ['formatted', 'Formatted'],
    ['raw', 'Raw'],
    ['copy', 'Copy'],
  ];
  for (const [action, label] of controls) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.action = action;
    button.textContent = label;
    if (action === 'formatted') button.setAttribute('aria-pressed', 'true');
    toolbar.append(button);
  }
  const copyStatus = document.createElement('span');
  copyStatus.className = 'rjf-copy-status';
  copyStatus.setAttribute('aria-live', 'polite');
  toolbar.append(copyStatus);
  root.append(toolbar);

  if (hasUnsafeInteger) {
    const warning = document.createElement('aside');
    warning.className = 'rjf-warning';
    warning.textContent =
      'Warning: this response contains an integer outside JavaScript’s safe range; the displayed parsed value may have lost precision. Raw view is unchanged.';
    root.append(warning);
  }

  const tree = document.createElement('section');
  tree.className = 'rjf-tree rjf-view';
  const raw = document.createElement('pre');
  raw.className = 'rjf-raw rjf-view';
  raw.hidden = true;
  raw.textContent = rawSource;
  root.append(tree, raw);

  const setExpanded = (row: HTMLElement, expanded: boolean) => {
    const state = states.get(row);
    if (!state) return;
    state.expanded = expanded;
    state.children.hidden = !expanded;
    state.toggle.textContent = expanded ? '▼' : '▶';
    state.toggle.setAttribute('aria-expanded', String(expanded));
    if (expanded && !state.materialized) {
      enqueue(() => {
        if (state.expanded && !state.materialized) materialize(row, state);
      });
    }
    else if (expanded && state.resume) {
      const resume = state.resume;
      state.resume = null;
      enqueue(resume);
    }
  };

  const createRow = (key: string | null, childValue: JsonValue): HTMLElement => {
    const row = document.createElement('div');
    row.className = 'rjf-row';
    const line = document.createElement('div');
    line.className = 'rjf-line';
    row.append(line);

    if (isContainer(childValue)) {
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'rjf-toggle';
      toggle.dataset.action = 'toggle';
      toggle.setAttribute('aria-label', 'Toggle JSON branch');
      line.append(toggle);
      if (key !== null) {
        const keySpan = document.createElement('span');
        keySpan.className = 'rjf-key';
        keySpan.textContent = JSON.stringify(key);
        line.append(keySpan);
      }
      const length = count(childValue);
      const opening = Array.isArray(childValue) ? '[' : '{';
      const closing = Array.isArray(childValue) ? ']' : '}';
      const showCount =
        itemCountMode === 'show' ||
        (itemCountMode === 'threshold' && length > itemCountThreshold);
      if (showCount) {
        const summary = document.createElement('span');
        summary.className = 'rjf-summary';
        summary.dataset.action = 'toggle';
        summary.textContent = `${opening}${length} ${length === 1 ? 'item' : 'items'}${closing}`;
        line.append(summary);
      }
      const children = document.createElement('div');
      children.className = 'rjf-children';
      row.append(children);
      states.set(row, {
        value: childValue,
        children,
        toggle,
        materialized: false,
        expanded: true,
        resume: null,
      });
      setExpanded(row, true);
    } else {
      const spacer = document.createElement('span');
      spacer.className = 'rjf-toggle';
      line.append(spacer);
      if (key !== null) {
        const keySpan = document.createElement('span');
        keySpan.className = 'rjf-key';
        keySpan.textContent = JSON.stringify(key);
        line.append(keySpan);
      }
      line.append(primitiveElement(childValue));
    }
    return row;
  };

  function materialize(row: HTMLElement, state: RowState): void {
    state.materialized = true;
    const arrayValue = Array.isArray(state.value) ? state.value : null;
    const objectValue = arrayValue ? null : state.value as { [key: string]: JsonValue };
    const keys = objectValue ? Object.keys(objectValue) : null;
    const length = arrayValue?.length ?? keys?.length ?? 0;
    const entryAt = (entryIndex: number): [string | null, JsonValue] => {
      if (arrayValue) {
        return [
          showArrayIndices ? String(entryIndex) : null,
          arrayValue[entryIndex] as JsonValue,
        ];
      }
      const key = keys?.[entryIndex] ?? '';
      return [key, objectValue?.[key] as JsonValue];
    };
    let index = 0;
    const addNext = () => {
      if (!state.expanded) {
        state.resume = addNext;
        return;
      }
      if (index >= length) return;
      const [key, childValue] = entryAt(index);
      const child = createRow(key, childValue);
      state.children.append(child);
      index++;
      if (index < length) enqueue(addNext);
    };
    const initial = Math.min(length, MATERIALIZE_CHUNK);
    for (; index < initial; index++) {
      const [key, childValue] = entryAt(index);
      const child = createRow(key, childValue);
      state.children.append(child);
    }
    if (index < length) enqueue(addNext);
  }

  tree.append(createRow(null, value));

  const setMode = (mode: 'formatted' | 'raw') => {
    tree.hidden = mode !== 'formatted';
    raw.hidden = mode !== 'raw';
    toolbar.querySelector<HTMLButtonElement>('[data-action="formatted"]')?.setAttribute(
      'aria-pressed',
      String(mode === 'formatted'),
    );
    toolbar.querySelector<HTMLButtonElement>('[data-action="raw"]')?.setAttribute(
      'aria-pressed',
      String(mode === 'raw'),
    );
  };

  const copyText = async (text: string): Promise<void> => {
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return;
      } catch {
        // HTTP JSON endpoints may not expose Clipboard API; use the legacy
        // user-gesture path without requesting a broad clipboard permission.
      }
    }
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.cssText = 'position:fixed;left:-9999px;top:0';
    root.append(textarea);
    textarea.select();
    const copied = document.execCommand('copy');
    textarea.remove();
    if (!copied) throw new Error('Copy was denied');
  };

  const showCopyStatus = (message: string, state: 'success' | 'error') => {
    if (disposed) return;
    if (copyStatusTimer !== null) window.clearTimeout(copyStatusTimer);
    copyStatus.textContent = message;
    copyStatus.dataset.state = state;
    copyStatusTimer = window.setTimeout(() => {
      copyStatusTimer = null;
      copyStatus.textContent = '';
      delete copyStatus.dataset.state;
    }, 3000);
  };

  root.addEventListener('click', (event) => {
    const target = (event.target as Element).closest<HTMLElement>('[data-action]');
    if (!target || !root.contains(target)) return;
    const action = target.dataset.action;
    if (action === 'toggle') {
      const row = target.closest<HTMLElement>('.rjf-row');
      if (row) setExpanded(row, !(states.get(row)?.expanded ?? false));
    } else if (action === 'formatted' || action === 'raw') {
      setMode(action);
    } else if (action === 'copy') {
      const text = raw.hidden ? JSON.stringify(value, null, 2) : rawSource;
      void copyText(text).then(
        () => { showCopyStatus('Copied!', 'success'); },
        () => { showCopyStatus('Copy failed', 'error'); },
      );
    }
  });

  const setTheme = (nextTheme: JsonTheme) => {
    document.documentElement.dataset.linchpinJsonTheme = nextTheme;
  };
  setTheme(theme);
  document.head.append(style);
  document.body.replaceChildren(root);

  return {
    setTheme,
    unmount() {
      if (disposed) return;
      disposed = true;
      pending.length = 0;
      if (scheduledFrame !== null && scheduledFrame >= 0) {
        cancelAnimationFrame(scheduledFrame);
      }
      if (copyStatusTimer !== null) window.clearTimeout(copyStatusTimer);
      style.remove();
      document.body.replaceChildren(...originalBodyNodes);
      delete document.documentElement.dataset.linchpinJsonTheme;
    },
  };
}
