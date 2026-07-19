import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  // Visible folder so Brave's Load unpacked picker can find it (dotdirs are hidden)
  outDir: 'dist',
  manifest: {
    name: 'Rivet',
    description:
      'Personal Reddit utility: tags, ignore, account switcher, infinite scroll. Not affiliated with Reddit or RES.',
    permissions: ['storage', 'cookies', 'tabs'],
    host_permissions: ['*://*.reddit.com/*', '*://reddit.com/*'],
    // Required for Firefox sideload / AMO; ignored by Chromium.
    browser_specific_settings: {
      gecko: {
        id: 'rivet@cicerbro',
        strict_min_version: '121.0',
        data_collection_permissions: {
          required: ['none'],
        },
      },
    },
  },
});
