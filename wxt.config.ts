import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  manifest: {
    name: 'Rivet',
    description:
      'Personal Reddit utility: tags, ignore, account switcher, infinite scroll. Not affiliated with Reddit or RES.',
    permissions: ['storage', 'cookies', 'tabs'],
    host_permissions: ['*://*.reddit.com/*', '*://reddit.com/*'],
  },
});
