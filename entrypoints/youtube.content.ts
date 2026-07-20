import {
  getSiteFeatureSettings,
  watchSiteFeatureSettings,
  type SiteFeatureSettings,
} from '../lib/core/siteFeatureSettings';
import { startYouTubeShortsRemoval } from '../lib/youtube/removeShorts';

export default defineContentScript({
  matches: ['*://www.youtube.com/*', '*://m.youtube.com/*'],
  runAt: 'document_start',
  main(ctx) {
    let stopFeature: (() => void) | null = null;

    const applySettings = (settings: SiteFeatureSettings) => {
      if (settings.youtube.removeShorts && !stopFeature) {
        stopFeature = startYouTubeShortsRemoval();
      } else if (!settings.youtube.removeShorts && stopFeature) {
        stopFeature();
        stopFeature = null;
      }
    };

    const stopWatch = watchSiteFeatureSettings(applySettings);
    void getSiteFeatureSettings().then(applySettings);
    ctx.onInvalidated(() => {
      stopWatch();
      stopFeature?.();
      stopFeature = null;
    });
  },
});
