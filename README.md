# Rivet

Personal [Manifest V3](https://developer.chrome.com/docs/extensions/mv3) extension for **Brave** (Chromium) and **Firefox**, built with [WXT](https://wxt.dev). A small Reddit utility for tags, ignore/hide, account switching, old-Reddit infinite scroll, subreddit last-visited hints, and new-comment counts — without the ~200 MB RES footprint.

**Not affiliated with Reddit or RES.** Personal-use sideload; secrets stay on your device.

## Features

| Feature | Notes |
|---|---|
| User tags | Labels + colors next to usernames (old + new Reddit) |
| Ignore / hide | Collapses posts/comments with a “Show anyway” control |
| Account switcher | Cookie-based session swap + optional TOTP helper for 2FA re-auth |
| Infinite scroll | Old Reddit listings only (new Reddit already has this) |
| Subreddit last-visited | Hint on the current sub + age badges on `/r/` links |
| New comment counts | Banner + highlight on revisited comment threads |
| Tag management popup | Add / edit / delete / search / color / ignore |
| RES import | Merge tags from Brave RES LevelDB export or pasted JSON |
| Safe backup JSON | Export/import settings + tags + visit maps (never accounts/secrets) |

## Install in Brave (unpacked)

1. Clone this repo and install deps:
   ```bash
   npm install
   npm run build
   ```
2. Open `brave://extensions`
3. Enable **Developer mode**
4. **Load unpacked** → select `dist/chrome-mv3` (produced by `npm run build`)
5. Open [old.reddit.com](https://old.reddit.com) or [www.reddit.com](https://www.reddit.com) and confirm the content script injects (popup → add a test tag)

For local development with HMR:

```bash
npm run dev
```

## Install in Firefox (temporary / unpacked)

Firefox builds are Manifest V3 (`--mv3`).

1. Build:
   ```bash
   npm install
   npm run build:firefox
   ```
2. Open `about:debugging#/runtime/this-firefox`
3. **Load Temporary Add-on…** → select `dist/firefox-mv3/manifest.json`
4. Open Reddit and confirm Rivet injects (popup → add a test tag)

Notes:

- Temporary add-ons are removed when Firefox quits; reload after each restart (or use `npm run zip:firefox` and install the zip for a longer-lived sideload on Developer Edition / Nightly with xpinstall unsigned, depending on your Firefox channel).
- Cookie/TOTP account switching uses the same APIs; behavior can differ slightly from Brave (partitioned cookies, container tabs). Prefer Capture → Switch on the same profile first.
- Dev with HMR: `npm run dev:firefox`

## Account switcher

Rivet stores multiple Reddit accounts (label + optional username) in `chrome.storage.local`.

**Preferred fast path — cookie swap**

1. Log into Reddit as account A in Brave
2. Open Rivet → **Add account** → label it → **Capture session**
3. Log into account B (or clear Reddit cookies / use incognito then paste) → add + capture
4. Click **Switch** to inject that account’s Reddit cookies and reload open Reddit tabs

**When the session is expired — TOTP assist**

1. Edit the account and paste your Reddit 2FA **Base32 TOTP secret** (from Reddit’s 2FA setup / authenticator backup)
2. Click **TOTP** to show a live 6-digit code (copyable)
3. Complete Reddit login with the code, then **Capture session** again

### Security caveats (read these)

- Cookies and TOTP secrets are stored **on-device only** in `chrome.storage.local`. They are **not** encrypted beyond whatever Brave provides for extension storage.
- Rivet only reads/writes cookies for **Reddit-related domains** (`*.reddit.com`, etc.). It does not touch other sites.
- **Export tags JSON never includes** account cookies, TOTP secrets, or session data.
- Do **not** commit real cookie dumps, TOTP secrets, or full Brave RES backups with `accountSwitcher` credentials to git.
- This is for **personal use** on a machine you trust. Anyone with access to your Brave profile can read extension storage.
- Brave / MV3 may restrict some cookie attributes (partitioned / certain SameSite cases). If injection fails, use TOTP + manual login, then re-capture.
- Never share your extension storage backup or screenshot TOTP codes.

## RES tag import

### Export from Brave RES storage

RES (extension id `kbmfpngjjgdllneeigpgjifpgocmfgmb`) stores `tag.<username>` entries in LevelDB under your Brave profile.

```bash
# Export all tag.* keys (votes + labels) and write seed files
npm run export:res-tags

# Only entries with text / color / ignore / link
npm run export:res-tags -- --labeled-only
```

This writes:

- `data/res-tags-seed.json`
- `public/data/res-tags-seed.json` (bundled into the extension)

The script **never** exports `RESoptions.accountSwitcher` or other credentials.

### Import / export in the popup

1. Open the Rivet popup → **Import / export**
2. **Export Rivet JSON** downloads a safe backup: settings, tags, subreddit visits, and thread visits
3. **Export tags only** downloads tags without settings/visits
4. Paste JSON and **Import** — or click **Load seed tags**
5. Import **merges** tags and visits; when `settings` is present it **replaces** settings
6. Account cookies / TOTP are **never** exported or imported (any `accounts` key in a file is ignored)

JSON shapes accepted:

```json
{
  "source": "rivet",
  "version": 1,
  "settings": {
    "enableTags": true,
    "enableIgnore": true,
    "enableOldRedditInfiniteScroll": true,
    "enableSubredditLastVisited": true,
    "enableNewCommentCounts": true,
    "tagBadgeStyle": "pill"
  },
  "tags": {
    "someuser": { "username": "someuser", "label": "bot", "color": "cornflowerblue", "updatedAt": 0 }
  },
  "subredditVisits": { "askreddit": 1710000000000 },
  "threadVisits": {
    "t3_abc": { "fullname": "t3_abc", "commentCount": 42, "visitedAt": 1710000000000 }
  }
}
```

RES-style tag files still work:

```json
{
  "tags": {
    "someuser": { "text": "bot", "color": "cornflowerblue" },
    "other": { "ignore": true }
  }
}
```

## Settings

- Show tags
- Hide ignored users
- Infinite scroll (old Reddit)
- Subreddit last-visited hints
- New comment counts on threads
- Badge style: pill (default) or text

## P3 page UI

- **Subreddit last-visited:** On `/r/foo`, a hint under the header shows when you last visited. Listing links can show a small “visited Xm ago” badge.
- **New comments:** On `/comments/…` threads you have opened before, a banner shows how many comments were added since the last visit; **Highlight new** outlines newer comments.

## Development

```bash
npm run compile        # Typecheck
npm run build          # Brave/Chromium → dist/chrome-mv3
npm run build:firefox  # Firefox MV3 → dist/firefox-mv3
npm run zip            # Zip Chromium build
npm run zip:firefox    # Zip Firefox MV3 build
```

## License

MIT
