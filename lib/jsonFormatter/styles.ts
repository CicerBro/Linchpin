/* Adapted from JSON Formatter master (bfd6356). Copyright (c) 2023,
 * Callum Locke. BSD-3-Clause. See ./THIRD_PARTY_NOTICES.md. */

export const JSON_FORMATTER_STYLES = `
:root {
  color-scheme: light dark;
  --rjf-bg: #fbfcfe;
  --rjf-fg: #343a40;
  --rjf-muted: #687078;
  --rjf-guide: #cdd3d9;
  --rjf-key: #7137e8;
  --rjf-string: #087b39;
  --rjf-number: #075cbd;
  --rjf-boolean: #075cbd;
  --rjf-null: #8a4b08;
  --rjf-control-bg: rgba(251, 252, 254, 0.96);
  --rjf-control-border: #c9cfd5;
  --rjf-warning-bg: #fff4ce;
  --rjf-warning-fg: #5f4400;
}
:root[data-linchpin-json-theme='dark'] {
  color-scheme: dark;
  --rjf-bg: #17191d;
  --rjf-fg: #e6e8eb;
  --rjf-muted: #9ba3ad;
  --rjf-guide: #474d56;
  --rjf-key: #b99aff;
  --rjf-string: #72d99b;
  --rjf-number: #7bb7ff;
  --rjf-boolean: #7bb7ff;
  --rjf-null: #e5c16f;
  --rjf-control-bg: rgba(31, 34, 40, 0.96);
  --rjf-control-border: #515762;
  --rjf-warning-bg: #4b3900;
  --rjf-warning-fg: #ffe18a;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-linchpin-json-theme='light']) {
    color-scheme: dark;
    --rjf-bg: #17191d;
    --rjf-fg: #e6e8eb;
    --rjf-muted: #9ba3ad;
    --rjf-guide: #474d56;
    --rjf-key: #b99aff;
    --rjf-string: #72d99b;
    --rjf-number: #7bb7ff;
    --rjf-boolean: #7bb7ff;
    --rjf-null: #e5c16f;
    --rjf-control-bg: rgba(31, 34, 40, 0.96);
    --rjf-control-border: #515762;
    --rjf-warning-bg: #4b3900;
    --rjf-warning-fg: #ffe18a;
  }
}
html,
body {
  min-height: 100%;
  margin: 0;
  background: var(--rjf-bg);
  color: var(--rjf-fg);
}
#linchpin-json-formatter {
  position: relative;
  box-sizing: border-box;
  min-height: 100vh;
  padding-top: 1px;
  font: 13px/1.55 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.rjf-toolbar {
  position: fixed;
  z-index: 3;
  top: 8px;
  right: 10px;
  display: flex;
  gap: 4px;
  padding: 4px;
  border: 1px solid var(--rjf-control-border);
  border-radius: 7px;
  background: var(--rjf-control-bg);
  box-shadow: 0 2px 9px rgba(15, 20, 18, 0.1);
  backdrop-filter: blur(8px);
}
.rjf-toolbar button {
  appearance: none;
  min-width: 56px;
  padding: 4px 8px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--rjf-muted);
  font: 12px/1.4 system-ui, sans-serif;
  cursor: pointer;
}
.rjf-toolbar button:hover {
  background: color-mix(in srgb, var(--rjf-fg) 8%, transparent);
  color: var(--rjf-fg);
}
.rjf-toolbar button[aria-pressed='true'] {
  background: color-mix(in srgb, var(--rjf-number) 13%, transparent);
  color: var(--rjf-number);
  font-weight: 650;
}
.rjf-toolbar button:focus-visible,
.rjf-toggle:focus-visible,
.rjf-value-string a:focus-visible {
  outline: 2px solid var(--rjf-number);
  outline-offset: 2px;
}
.rjf-copy-status {
  align-self: center;
  min-width: 0;
  color: var(--rjf-muted);
  font: 12px/1.4 system-ui, sans-serif;
}
.rjf-copy-status:not(:empty) {
  min-width: 6ch;
  padding-right: 4px;
}
.rjf-copy-status[data-state='success'] {
  color: var(--rjf-string);
  font-weight: 650;
}
.rjf-warning {
  margin: 8px 188px 0 12px;
  padding: 8px 10px;
  border-radius: 6px;
  background: var(--rjf-warning-bg);
  color: var(--rjf-warning-fg);
  font-family: system-ui, sans-serif;
}
.rjf-tree {
  min-width: max-content;
  padding: 7px 18px 40px 11px;
}
.rjf-row {
  position: relative;
  display: block;
  min-height: 20px;
}
.rjf-line {
  display: flex;
  min-width: max-content;
  align-items: baseline;
}
.rjf-toggle {
  width: 18px;
  min-width: 18px;
  height: 19px;
  margin: 0 1px 0 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--rjf-muted);
  font: 10px/1 ui-monospace, monospace;
  text-align: center;
  cursor: pointer;
  opacity: 0.82;
}
span.rjf-toggle {
  cursor: default;
}
.rjf-toggle:hover {
  opacity: 1;
}
.rjf-key {
  color: var(--rjf-key);
}
.rjf-key::after {
  color: var(--rjf-fg);
  content: ': ';
  white-space: pre;
}
.rjf-summary {
  color: var(--rjf-muted);
  cursor: pointer;
  user-select: none;
}
.rjf-children {
  margin-left: 9px;
  padding-left: 9px;
  border-left: 1px dotted var(--rjf-guide);
}
.rjf-value-string {
  color: var(--rjf-string);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.rjf-value-string a {
  color: inherit;
  text-decoration: none;
}
.rjf-value-string a:hover,
.rjf-value-string a:active {
  text-decoration: underline;
  text-decoration-thickness: 1px;
  text-underline-offset: 2px;
}
.rjf-value-number,
.rjf-value-boolean {
  color: var(--rjf-number);
  font-weight: 650;
}
.rjf-value-null {
  color: var(--rjf-null);
  font-weight: 650;
}
.rjf-children[hidden],
.rjf-view[hidden] {
  display: none !important;
}
.rjf-raw {
  box-sizing: border-box;
  min-height: 100vh;
  margin: 0;
  padding: 42px 12px 20px;
  overflow-wrap: anywhere;
  color: var(--rjf-fg);
  white-space: pre-wrap;
}
@supports not (color: color-mix(in srgb, black, white)) {
  .rjf-toolbar button:hover {
    background: rgba(100, 110, 105, 0.1);
  }
  .rjf-toolbar button[aria-pressed='true'] {
    background: rgba(7, 92, 189, 0.12);
  }
}
`;
