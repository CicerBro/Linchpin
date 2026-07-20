import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  // Visible folder so Brave's Load unpacked picker can find it (dotdirs are hidden)
  outDir: 'dist',
  manifest: ({ browser }) => ({
    name: 'Linchpin',
    description:
      'A lightweight personal browser toolkit for Reddit, search, media, JSON, and AI summaries.',
    permissions: ['storage', 'tabs', 'activeTab', 'scripting'],
    host_permissions: ['*://*.reddit.com/*', '*://reddit.com/*'],
    optional_host_permissions: [
      'https://api.openai.com/*',
      'https://api.anthropic.com/*',
      'https://api.x.ai/*',
      'https://api.moonshot.ai/*',
      'https://generativelanguage.googleapis.com/*',
      'https://open.bigmodel.cn/*',
      'https://openrouter.ai/*',
    ],
    icons: {
      16: 'icon/16.png',
      32: 'icon/32.png',
      48: 'icon/48.png',
      96: 'icon/96.png',
      128: 'icon/128.png',
    },
    action: {
      default_icon: {
        16: 'icon/16.png',
        32: 'icon/32.png',
        48: 'icon/48.png',
      },
      // Firefox can follow the actual toolbar theme natively. The property
      // names describe the icon artwork: a light icon is used on dark chrome.
      ...(browser === 'firefox'
        ? {
            theme_icons: [
              {
                dark: 'icon/16.png',
                light: 'icon/dark-theme-16.png',
                size: 16,
              },
              {
                dark: 'icon/32.png',
                light: 'icon/dark-theme-32.png',
                size: 32,
              },
            ],
          }
        : {}),
    },
    content_security_policy: {
      extension_pages: "script-src 'self'; object-src 'self'",
    },
    // Required for Firefox sideload / AMO; ignored by Chromium.
    browser_specific_settings: {
      gecko: {
        id: 'linchpin@cicerbro',
        strict_min_version: '121.0',
        data_collection_permissions: {
          required: ['none'],
        },
      },
    },
  }),
});
