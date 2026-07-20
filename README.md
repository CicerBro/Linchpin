# Linchpin

**A lightweight personal browser toolkit for Reddit, search, media, JSON, and AI summaries.**

![Linchpin icon](./public/linchpin.svg)

Linchpin is a Manifest V3 extension for Chromium browsers and Firefox, built with [WXT](https://wxt.dev). It keeps ambient work site-scoped and event-driven; PiP and page summarization run only after a user action.

Linchpin is not affiliated with Reddit, Google, YouTube, RES, Callum Locke, or any AI provider.

## Features

| Area         | Features                                                                                                                           |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| Reddit       | User tags and ignore rules, account switching, bounded old-Reddit infinite scroll, subreddit visit hints, and new-comment counts   |
| JSON         | Automatic detection, lazy tree rendering, raw/formatted views, expand/collapse, copy, theme selection, and unsafe-integer warnings |
| Google       | Restored Maps search tab and a View Image action on Google Images                                                                  |
| YouTube      | Optional CSS-first Shorts removal and `/shorts/…` to `/watch?v=…` conversion                                                       |
| Media        | User-triggered native Picture-in-Picture for the most useful visible video                                                         |
| AI summaries | User-triggered extraction and plain-text summaries using OpenAI, Anthropic, xAI, Kimi/Moonshot, Gemini, GLM/Zhipu, or OpenRouter   |

Settings are grouped by feature and can be changed independently. Existing version 0.2 settings are migrated on first run.

## Install

```bash
npm install
npm run build
```

Load `dist/chrome-mv3` from the browser's extensions page with Developer mode enabled.

For Firefox:

```bash
npm run build:firefox
```

Load `dist/firefox-mv3/manifest.json` from `about:debugging#/runtime/this-firefox`. Temporary Firefox add-ons are removed when Firefox exits.

## Privacy and permissions

- `storage` holds settings, Reddit data, provider configuration, and locally saved account sessions.
- `cookies` plus Reddit host access power the existing account switcher.
- `tabs`, `activeTab`, and `scripting` support current-tab metadata and user-triggered PiP or summary extraction.
- The tiny JSON content script matches general web pages because response pages can use any origin. Its ordinary-HTML path exits after cheap detection checks and it installs no observer after formatting.
- Google and YouTube scripts match only their own supported hosts.
- AI provider origins are optional permissions. Linchpin requests access when a configured provider needs it.

No analytics, telemetry, cloud account, remote configuration, summary history, or background polling is included.

API keys, Reddit cookies, and TOTP secrets are stored only in extension-local storage. That storage is not strong encryption: anyone who can inspect the browser profile may be able to read it. Secrets are excluded from normal Linchpin exports, and Linchpin does not log authorization headers or extracted page text.

## Using tab summaries

1. Configure a provider and API key in the popup, then choose a default from the models Linchpin loads from that provider.
2. Open the page to summarize and choose **Summarize this tab**.
3. Review the extracted title, site, and text length, then choose from the provider's currently available models.
4. Start the request, or close/cancel without sending anything.

Extraction injects Mozilla Readability only after the user requests a summary and runs it against a clone of the live document. It falls back to Schema.org `articleBody`, selected text, `article`, `main`, or bounded visible body text. Content is converted to plain text, capped at about 80,000 characters, treated as untrusted input, and never given browser tools.

## Reddit account switching

Linchpin can capture Reddit cookies for a named local account and later swap them back. An optional Base32 TOTP secret can generate a login code when a captured session expires. Account switches are serialized so popup and in-page controls cannot interleave cookie changes; partial failures are reported for manual recovery.

These values are sensitive. Do not commit cookie dumps or TOTP secrets, and recapture a session after completing a manual recovery.

## Import and export

The popup accepts Linchpin backups and RES-style tag JSON. Imported entries are validated individually: usernames, labels, colors, links, numeric votes, timestamps, visit maps, and settings must have supported shapes and bounded values. Tag links must use HTTP(S), and colors must be valid CSS colors without markup.

Normal exports include only settings, tags, subreddit visits, and thread visits. Account cookies, TOTP secrets, and provider API keys are always excluded.

Visit histories are pruned during startup/writes, never by a timer: threads keep the 5,000 most recent entries and subreddits keep 2,000. Old-Reddit infinite scroll stops after 20 fetched pages or 500 appended posts and provides a normal next-page link.

## Performance model

- No polling timers in ordinary content scripts.
- Reddit and Google mutations are deduplicated and flushed at most once per animation frame, with a microtask fallback for hidden tabs.
- Features have explicit start/stop cleanup and only the changed feature is restarted.
- Site scripts process added subtrees instead of repeatedly scanning the full document.
- YouTube removal is CSS-first.
- PiP and summary extraction install no persistent all-page observers.
- JSON branches render only when expanded and input is limited to 10 MB.

## Development

```bash
npm run compile
npm run build
npm run build:firefox
npm run zip
npm run zip:firefox
```

Inspect the generated Chromium and Firefox manifests after permission or entrypoint changes. The implementation intentionally uses plain TypeScript and DOM APIs rather than a popup framework or full AI SDK.

## Third-party code

The JSON formatter adapts runtime behavior from Callum Locke's `json-formatter` v0.8.0 (`27aa995`) under the BSD-3-Clause license. See `[lib/jsonFormatter/THIRD_PARTY_NOTICES.md](lib/jsonFormatter/THIRD_PARTY_NOTICES.md)` and the formatter source headers for attribution and Linchpin-specific changes. `@mozilla/readability` is used only during user-triggered summary extraction under its Apache-2.0 license.

Linchpin's original code remains under the [MIT License](LICENSE).
