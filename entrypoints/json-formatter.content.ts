/* Adapted from JSON Formatter master (bfd6356). See ../lib/jsonFormatter/THIRD_PARTY_NOTICES.md. */

import {
  getSiteFeatureSettings,
  watchSiteFeatureSettings,
} from '../lib/core/siteFeatureSettings';
import { detectJsonSource } from '../lib/jsonFormatter/detect';
import { parseJsonOnce } from '../lib/jsonFormatter/parse';
import { mountJsonFormatter } from '../lib/jsonFormatter/render';

export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  runAt: 'document_idle',
  async main(ctx) {
    const settings = await getSiteFeatureSettings();
    if (!settings.jsonFormatter.enabled) return;
    const source = detectJsonSource(document);
    if (source === null) return;
    const parsed = parseJsonOnce(source);
    if (!parsed) return;
    const mountWith = (jsonSettings: typeof settings.jsonFormatter) =>
      mountJsonFormatter({
        ...parsed,
        rawSource: source,
        theme: jsonSettings.darkMode,
        showArrayIndices: jsonSettings.showArrayIndices,
        itemCountMode: jsonSettings.itemCountMode,
        itemCountThreshold: jsonSettings.itemCountThreshold,
      });
    let activeJsonSettings = settings.jsonFormatter;
    let mount: ReturnType<typeof mountJsonFormatter> | null = mountWith(activeJsonSettings);
    const stopWatch = watchSiteFeatureSettings((next) => {
      if (!next.jsonFormatter.enabled) {
        mount?.unmount();
        mount = null;
        activeJsonSettings = next.jsonFormatter;
        return;
      }
      if (!mount) {
        mount = mountWith(next.jsonFormatter);
      } else if (
        next.jsonFormatter.showArrayIndices !== activeJsonSettings.showArrayIndices ||
        next.jsonFormatter.itemCountMode !== activeJsonSettings.itemCountMode ||
        next.jsonFormatter.itemCountThreshold !== activeJsonSettings.itemCountThreshold
      ) {
        mount.unmount();
        mount = mountWith(next.jsonFormatter);
      } else {
        mount.setTheme(next.jsonFormatter.darkMode);
      }
      activeJsonSettings = next.jsonFormatter;
    });
    ctx.onInvalidated(() => {
      stopWatch();
      mount?.unmount();
      mount = null;
    });
  },
});
