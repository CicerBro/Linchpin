# Linchpin: Next-Version Plan

## Product direction

Keep the name **Linchpin**. It already works beyond Reddit: Linchpin is the small tool that holds several useful browser features together. Use the product description:

> A lightweight personal browser toolkit for Reddit, search, media, JSON, and AI summaries.

This version should replace several single-purpose extensions without turning into a permanently busy, all-access process. The design target is normal tabs remaining open for up to roughly 24 hours, with no continuous idle work and sensible hard limits against runaway pages.

## Goals

- Preserve all existing Reddit features.
- Add an automatic JSON formatter.
- Restore Google Search Maps links.
- Restore View Image on Google Images.
- Add user-triggered Picture-in-Picture.
- Add a toggleable YouTube Shorts remover.
- Add user-triggered tab summarization with OpenAI, Anthropic, xAI, Kimi, Gemini, and GLM.
- Keep CPU use effectively idle when pages are not changing.
- Keep per-tab memory bounded enough for a 24-hour browser session.
- Keep permissions and dependencies as narrow as the features allow.
- Generate a distinctive new Linchpin icon set and use it in every build target.

## Non-goals for this pass

- No automated test suite yet. Add tests after the feature architecture and behavior stabilize.
- No framework migration for the popup.
- No cloud account, sync service, analytics, telemetry, or remote configuration.
- No copying source from SuperLevels. JSON Formatter is the deliberate exception: reuse and adapt its proven formatter implementation under its BSD-3-Clause license.
- No generalized cookie editor, dark mode, tab cleaner, music recognition, or other SuperLevels features.

## Performance rules

These are implementation constraints, not later optimizations:

1. No polling timers in ordinary content scripts.
2. No content script should do repeated whole-document scans after startup.
3. DOM mutations must be collected and processed in one scheduled batch, at most once per animation frame.
4. Mutation handlers process only the smallest useful added roots and deduplicate nested roots.
5. Prefer CSS for purely visual removal, such as hiding YouTube Shorts shelves.
6. User-triggered features such as summarization and PiP must not require persistent all-page observers.
7. Every observer, timer, event listener, message port, and in-flight request must have a cleanup path.
8. Stored histories and in-memory collections need explicit caps or pruning rules.
9. Large JSON and page text must have size limits and lazy rendering rather than eagerly creating unbounded DOM trees.
10. Disabled features should not start and should remove their injected UI immediately when toggled off.

## Dependency policy

Start lean. Do not add a DOM mutation library: native `MutationObserver`, `requestAnimationFrame`, `Set`, `WeakSet`, and scoped selectors are sufficient and avoid another runtime abstraction.

Recommended external dependency:

- `@mozilla/readability`, used only when the user explicitly requests a tab summary. Run its inexpensive readerability check first, parse a cloned document, set `maxElemsToParse`, return only text and metadata, and discard the clone immediately.

Avoid initially:

- React, Vue, or another popup framework.
- A full AI SDK. Six small provider adapters using `fetch` will be smaller and easier to audit.
- DOMPurify if extracted content is always converted to plain text and rendered with `textContent`. Add a sanitizer only if a later version renders extracted HTML.
- Large JSON editor/viewer packages. Vendor only the useful runtime portions of Callum Locke's JSON Formatter rather than bringing in its React, Tailwind, or build-time dependency tree.
- General observer/helper packages that wrap native browser primitives.

## Proposed structure

```text
entrypoints/
  background.ts
  reddit.content.ts
  json-formatter.content.ts
  google-tools.content.ts
  youtube.content.ts
  popup/
    index.html
    main.ts
    style.css
  summary/
    index.html
    main.ts
    style.css

lib/
  core/
    feature.ts
    lifecycle.ts
    mutationBatch.ts
    navigation.ts
    messages.ts
  storage/
    schema.ts
    settings.ts
    repositories.ts
    migrations.ts
  reddit/
    ...existing Reddit modules
  jsonFormatter/
    detect.ts
    parse.ts
    render.ts
    styles.ts
  google/
    maps.ts
    viewImage.ts
  youtube/
    removeShorts.ts
  media/
    pictureInPicture.ts
  summarizer/
    extract.ts
    prompts.ts
    types.ts
    providers/
      openaiCompatible.ts
      openai.ts
      anthropic.ts
      xai.ts
      kimi.ts
      gemini.ts
      glm.ts
  accounts/
  import/

public/
  icon/
  data/
```

Keep separate WXT content-script entrypoints with narrow match patterns. Do not create one universal content script containing every feature.

## Phase 1: Stabilize the current code

Do this before adding new features so the new architecture does not preserve current bottlenecks.

### 1.1 Safe rendering and input validation

- Replace popup interpolation of imported tag fields with DOM construction or consistently escaped attribute values.
- Validate every imported tag entry, not just one sample entry.
- Accept only supported primitives and reasonable string lengths.
- Validate colors with `CSS.supports('color', value)` and reject values containing markup.
- Allow only `http:` and `https:` tag links.
- Render provider errors, summaries, account names, tags, and imported data with `textContent` by default.
- Keep extension-page CSP restrictive.

### 1.2 One batched Reddit mutation pipeline

- Replace per-added-node calls to `refresh()` with a shared mutation batcher.
- Deduplicate roots: if a queued root contains another queued root, process only the parent.
- Schedule one flush with `requestAnimationFrame`; use a microtask fallback for hidden tabs.
- Pass the root into every feature. `refreshSubredditVisitBadges` must not scan the entire document for every mutation.
- Remove the `querySelectorAll('*')` shadow-root walk from author detection. Check known Reddit hosts and open shadow roots encountered in relevant subtrees only.
- Merge account-menu remount detection into the same Reddit observer or observe only the header container.
- Mark processed elements so unchanged author and subreddit links are not rebuilt.

### 1.3 Explicit feature lifecycle

Define a small common contract:

```ts
type FeatureController = {
  start(): void | Promise<void>;
  stop(): void;
};
```

- Give every Reddit feature a controller.
- Store and call every cleanup function, including storage watchers and the account menu.
- Restart only the feature whose setting changed instead of restarting all page features.
- Add a navigation utility for Reddit SPA transitions. On URL change, stop route-specific controllers and start the correct ones for the new route.
- Prefer site-native navigation events when available, with patched history plus `popstate` as a small fallback.

### 1.4 Bounded state and storage writes

- Add a versioned storage schema and migrations before adding many more settings.
- Serialize read-modify-write storage operations through the background worker to avoid lost updates from multiple Reddit tabs.
- Cap thread history at the 5,000 most recently visited threads.
- Cap subreddit history at 2,000 entries.
- Prune only during writes and at startup; never run a periodic cleanup timer.
- Keep all user tags unless the user deletes them.
- Make `mergeTags().skipped` accurate, and avoid writing unchanged tag maps.
- Add a global account-switch lock so popup and in-page controls cannot interleave cookie replacement.
- Report partial cookie injection clearly and retain enough state for a manual recovery path.

### 1.5 Bound old-Reddit infinite scroll

Full virtualization is unnecessary for the expected 24-hour tab lifetime and would add substantial complexity. Use a simpler guard:

- Track fetched page count and appended post count.
- Stop appending after 20 fetched pages or 500 appended posts, whichever comes first.
- Replace the sentinel with a normal “Continue on the next Reddit page” link using the current `nextUrl`.
- Clear parsed remote documents and temporary node arrays after each append.
- Keep the existing `seen` set only for the current listing and clear it on stop/navigation.

### 1.6 Popup cleanup

- Split the 700-line popup module into settings, accounts, Reddit tags, import/export, and provider configuration sections.
- Continue using plain TypeScript and DOM APIs.
- Prefer event delegation so a render does not bind listeners to every row again.
- Stop rerendering the entire popup for every search keystroke; update the list section only.
- Generate TOTP once per period boundary and update the visible countdown locally rather than messaging the background worker every second.

## Phase 2: Feature registry and settings UI

Create a versioned settings model with independent flags:

```ts
type FeatureSettings = {
  reddit: {
    tags: boolean;
    ignore: boolean;
    accountSwitcher: boolean;
    infiniteScroll: boolean;
    subredditVisits: boolean;
    newCommentCounts: boolean;
  };
  jsonFormatter: { enabled: boolean; darkMode: 'system' | 'light' | 'dark' };
  google: { mapsButton: boolean; viewImage: boolean };
  youtube: { removeShorts: boolean };
  summarizer: { enabled: boolean; provider: string; model: string };
};
```

PiP is an action rather than an ambient setting. It can be shown in the popup whenever the current page contains a usable video.

Settings requirements:

- Preserve current settings through a migration.
- Group settings by feature rather than one long flat form.
- Do not load provider code until the summary page is opened.
- Store provider/model choice separately from API keys.
- Never include API keys, cookies, or TOTP secrets in normal exports.
- Explain plainly that API keys in extension local storage are not strongly encrypted.

## Phase 3: JSON formatter

This is the only feature that needs an automatic content script on general web pages. Keep its non-JSON path extremely short.

Use Callum Locke's JSON Formatter as the implementation base. It already has the desired behavior and has been tuned for large JSON documents. This is source reuse rather than an npm dependency:

- Pin and record the exact upstream tag or commit used.
- Copy only the relevant detection, parsing, rendering, interaction, and styling code.
- Port the copied runtime code to strict TypeScript and Linchpin's WXT entrypoint structure.
- Preserve its useful behavior and keyboard/mouse interactions unless a change is intentional.
- Retain the upstream BSD-3-Clause copyright and license text in a third-party notices file and in derived source-file headers where appropriate.
- Do not imply that Callum Locke endorses Linchpin.
- Keep Linchpin's own code under its existing license; identify the adapted formatter files separately.
- Do not copy the upstream build system, React popup code, Tailwind setup, extension manifest, branding, analytics, or unrelated development dependencies.
- Audit the vendored code for extension CSP compatibility, unsafe HTML insertion, obsolete Chrome-only APIs, and interactions with WXT/Firefox.
- Document Linchpin-specific changes so a future upstream comparison is manageable even though the upstream project is archived.

The objective is feature and performance parity with the formatter that already works well, followed by a clean integration—not a speculative rewrite of its core tree view.

Detection order:

1. Exit unless the feature is enabled.
2. Check `document.contentType` for `application/json` or a `+json` subtype.
3. As a fallback, accept only a simple document containing one `pre` element whose trimmed text starts with `{` or `[`.
4. Apply a configurable maximum input size before parsing; initially 10 MB.
5. Attempt `JSON.parse` once. On failure, leave the page untouched.

Rendering:

- Preserve the exact raw source for a Raw view and copying.
- Provide formatted, raw, expand-all, collapse-all, and copy controls.
- Render objects and arrays lazily: create child rows only when a node is expanded.
- Start deeply nested or large containers collapsed.
- Use delegated click handlers rather than one listener per row.
- Use CSS custom properties for light/dark/system themes.
- Display a warning when parsed numeric values exceed JavaScript safe-integer precision.
- Never run a mutation observer after the JSON view is mounted.

Permissions:

- Automatic formatting necessarily requires broad page matching. Keep that access isolated to this tiny content script and document why it exists.
- If broad automatic access is unacceptable, retain an alternative manual “Format this tab” mode using `activeTab`.

## Phase 4: Google tools

Use one Google-only entrypoint and one shared, batched observer for both tools.

### Maps button

- Detect normal Google Search pages and the current query.
- Add a Maps tab/link in the same navigation region as Images, News, and Shopping.
- Prefer a stable Google Maps search URL built from the query rather than scraping a fragile result URL.
- Do not inject duplicates after Google SPA navigation or result updates.
- Maintain one centralized list of supported Google country hosts.

### View Image

- Activate only on Google Images result pages.
- Add a View Image action for the currently selected result.
- Resolve the best original image URL from stable link/data attributes first, falling back conservatively.
- Restrict destinations to `http:` and `https:`.
- Update the existing control when selection changes rather than creating new controls.
- Remove the injected control when disabled or when navigating away from image results.

Because Google markup changes regularly, isolate selectors and fallbacks in small named functions rather than spreading them through event handlers.

## Phase 5: YouTube Shorts removal

- Match only YouTube hosts.
- Keep the feature behind `youtube.removeShorts`.
- Use an injected stylesheet for shelves, navigation items, chips, and Shorts cards that have stable markers.
- Use a small batched mutation handler only for cases CSS cannot identify reliably.
- Listen for YouTube's SPA navigation completion event and re-evaluate the route.
- Hide Shorts from home, subscriptions, search, and sidebar navigation.
- When a direct `/shorts/{id}` URL has an equivalent watch URL, redirect to `/watch?v={id}`; otherwise show the page rather than creating a redirect loop.
- On disable, remove the stylesheet, injected markers, and navigation listeners immediately.

## Phase 6: Picture-in-Picture

Make PiP entirely user-triggered:

- Add a “Picture in Picture” popup action.
- Use `activeTab` plus `scripting` to inspect the current tab only after the click.
- Select the playing visible video first; otherwise choose the largest visible `HTMLVideoElement`.
- Call the native Picture-in-Picture API from the click-triggered flow.
- Return clear errors for unsupported pages, protected media, missing videos, and browser denial.
- Do not install a persistent PiP content script or observer.
- Keep Firefox behavior behind a capability check rather than browser-name checks.

## Phase 7: AI tab summarizer

The linked SuperLevels repository does not currently provide this feature, so design it as a clean Linchpin module.

### User flow

1. User opens “Summarize this tab.”
2. Linchpin opens a dedicated extension summary page or Chromium side panel. Firefox can fall back to the extension page in a tab.
3. Linchpin injects extraction code into the active tab on demand.
4. The page shows extracted title, site, length, provider, and model before sending.
5. User starts the request and cancels it if needed.
6. Render the response as safe plain text initially, with copy and retry actions.

Do not make the browser-action popup responsible for a long request because it disappears easily when focus changes.

### Extraction

- Run only after explicit user action.
- Prefer Mozilla Readability on a cloned document with `maxElemsToParse` set.
- Fall back to selected text, `article`, `main`, and finally bounded visible body text.
- Remove scripts, styles, navigation, cookie banners, forms, hidden text, and extension UI.
- Return plain text plus title, URL, byline, language, and excerpt.
- Normalize whitespace and cap the default payload at roughly 80,000 characters.
- For longer content, offer truncation or sequential chunk summarization. Process one chunk at a time and discard it before the next to keep memory bounded.
- Treat page text as untrusted prompt content and give the summarizer no tools or browser actions.

### Provider architecture

Define one provider contract:

```ts
type SummarizeRequest = {
  model: string;
  systemPrompt: string;
  content: string;
  signal: AbortSignal;
};

interface SummarizerProvider {
  id: string;
  summarize(request: SummarizeRequest): Promise<string>;
}
```

- Implement a shared OpenAI-compatible transport where the provider supports it.
- Keep native adapters for Anthropic Messages and Gemini APIs.
- Give OpenAI, xAI, Kimi/Moonshot, and GLM/Zhipu explicit presets even when they share a transport.
- Keep model names editable because provider catalogs change frequently.
- Validate endpoint URLs and do not allow non-HTTPS endpoints unless a future explicit local-model mode is added.
- Use non-streaming responses initially. Streaming adds lifecycle and parser complexity and can be added after the base workflow is reliable.
- Add timeout, abort, rate-limit, authentication, quota, and malformed-response handling.
- Request provider host access only when the user configures/enables that provider where the browser supports optional permissions.
- Never log API keys, authorization headers, full page text, or full provider responses.
- Store no summary history initially; this avoids unbounded sensitive data and keeps the first version simple.

## Phase 8: Branding and icons

Create a new Linchpin identity rather than reusing the current generic outline icon.

Creative direction:

- A circular pin head made from several interlocking segments, evoking a linchpin that holds parts together.
- Graphite/dark neutral base with one vivid green accent, retaining a subtle connection to the existing color.
- Strong silhouette with generous transparent padding.
- No text and no tiny interior detail.
- Recognizable at 16 px in both light and dark browser chrome.

Process:

1. Generate several high-resolution square concepts.
2. Select one silhouette and simplify it manually if needed.
3. Produce a 1024 px source asset.
4. Export crisp 16, 32, 48, 96, and 128 px PNGs.
5. Inspect every size independently; do not assume downscaling preserves clarity.
6. Update WXT manifest icons, popup branding, README screenshots, and extension descriptions.

## Phase 9: Permissions and packaging review

Expected permissions:

- `storage` for settings and local data.
- `cookies` and Reddit host access for the existing account switcher.
- `tabs` for existing tab reload behavior and current-tab metadata.
- `activeTab` and `scripting` for user-triggered PiP and summarization extraction.
- General page matching only for automatic JSON formatting.
- Google and YouTube host access only for their respective content scripts.
- Provider hosts as optional permissions when feasible.

Do not add `webRequest`, `webNavigation`, `tabCapture`, `contentSettings`, or `<all_urls>` background access unless an implemented feature demonstrates a concrete need.

Build separate Chromium and Firefox packages and inspect their generated manifests. Firefox fallbacks should degrade cleanly when side-panel or PiP behavior differs.

## Manual verification for this pass

Automated tests are intentionally deferred, but each phase should be manually checked before continuing:

- TypeScript compilation succeeds.
- Chromium and Firefox builds succeed.
- Generated manifests contain only expected permissions and host matches.
- Existing Reddit settings and data survive migration.
- Reddit old/new UI features still work across SPA navigation and full reloads.
- A busy Reddit or Google page does not produce continuous idle CPU usage.
- Mutation bursts produce one batched processing pass, not one full scan per node.
- Infinite scroll stops at its guard and offers a normal next-page link.
- Malformed imports cannot inject markup into extension pages.
- JSON pages format correctly; ordinary HTML pages remain untouched.
- Large JSON opens with lazy branches and without freezing the tab.
- Google controls do not duplicate during navigation.
- YouTube Shorts disappear only when enabled and return when disabled.
- PiP runs only after a click and leaves no persistent page code.
- Each AI provider succeeds with a small page, rejects missing/invalid credentials clearly, and cancels cleanly.
- No secrets or page contents appear in logs or exports.
- Closing the summary UI aborts its request and releases extracted content.

## Recommended implementation order

1. Current-code safety and performance fixes.
2. Feature registry, lifecycle, storage migration, and reorganized popup.
3. JSON formatter.
4. Google Maps and View Image.
5. YouTube Shorts removal.
6. Picture-in-Picture.
7. AI summarizer and provider adapters.
8. New icons and branding.
9. Permissions, packaging, documentation, and final manual profiling.

This order addresses the existing CPU and rendering risks first, then adds the cheapest site-scoped features, and leaves the provider-heavy summarizer until the shared architecture is stable.
