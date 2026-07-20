import {
  getSiteFeatureSettings,
  watchSiteFeatureSettings,
  type SiteFeatureSettings,
} from '../lib/core/siteFeatureSettings';
import { GOOGLE_MATCH_PATTERNS } from '../lib/google/hosts';
import { removeMapsButton, updateMapsButton } from '../lib/google/maps';
import { removeViewImageButton, updateViewImageButton } from '../lib/google/viewImage';

export default defineContentScript({
  matches: GOOGLE_MATCH_PATTERNS,
  runAt: 'document_idle',
  main(ctx) {
    let settings: SiteFeatureSettings | null = null;
    let observer: MutationObserver | null = null;
    let frame: number | null = null;
    let microtaskPending = false;

    const refresh = () => {
      if (!settings) return;
      updateMapsButton(settings.google.mapsButton);
      updateViewImageButton(settings.google.viewImage);
    };

    const scheduleRefresh = () => {
      if (frame !== null || microtaskPending) return;
      if (document.visibilityState === 'hidden') {
        microtaskPending = true;
        queueMicrotask(() => {
          microtaskPending = false;
          refresh();
        });
      } else {
        frame = requestAnimationFrame(() => {
          frame = null;
          refresh();
        });
      }
    };

    const syncObserver = () => {
      const shouldObserve = Boolean(settings?.google.mapsButton || settings?.google.viewImage);
      if (shouldObserve && !observer) {
        observer = new MutationObserver(scheduleRefresh);
        observer.observe(document.documentElement, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['aria-selected', 'data-iurl', 'href', 'src'],
        });
      } else if (!shouldObserve && observer) {
        observer.disconnect();
        observer = null;
      }
    };

    const applySettings = (next: SiteFeatureSettings) => {
      settings = next;
      syncObserver();
      refresh();
    };

    const stopWatch = watchSiteFeatureSettings(applySettings);
    const onNavigate = () => scheduleRefresh();
    window.addEventListener('popstate', onNavigate);
    void getSiteFeatureSettings().then(applySettings);

    ctx.onInvalidated(() => {
      stopWatch();
      observer?.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
      window.removeEventListener('popstate', onNavigate);
      removeMapsButton();
      removeViewImageButton();
    });
  },
});
