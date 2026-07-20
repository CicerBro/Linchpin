/** Keeps Chromium's action icon legible when the system color scheme changes. */
export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  runAt: 'document_start',
  main(ctx) {
    // Firefox selects the native manifest theme_icons against its actual
    // toolbar theme; calling setIcon there would override that behavior.
    if (import.meta.env.BROWSER === 'firefox') return;

    const colorScheme = window.matchMedia('(prefers-color-scheme: dark)');
    let lastTheme: 'light' | 'dark' | null = null;

    const syncIcon = () => {
      const theme = colorScheme.matches ? 'dark' : 'light';
      if (theme === lastTheme) return;
      lastTheme = theme;
      void browser.runtime.sendMessage({
        type: 'linchpin:set-action-icon-theme',
        theme,
      }).catch(() => {
        // The extension may be reloading while this content script is alive.
      });
    };

    colorScheme.addEventListener('change', syncIcon);
    syncIcon();
    ctx.onInvalidated(() => colorScheme.removeEventListener('change', syncIcon));
  },
});
