import { extractLivePageForSummary } from '../lib/summarizer/extract';

/** Injected only after an explicit Summarize action. */
export default defineUnlistedScript(async () => {
  try {
    const page = await extractLivePageForSummary();
    await browser.runtime.sendMessage({
      type: 'linchpin:summary-extraction-result',
      page,
    });
  } catch (error) {
    await browser.runtime.sendMessage({
      type: 'linchpin:summary-extraction-result',
      error: error instanceof Error ? error.message : 'Live extraction failed.',
    });
  }
});
