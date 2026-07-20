import { requestPictureInPictureForBestVideo } from '../../lib/media/pictureInPicture';

async function activeTabId(): Promise<number> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab?.id == null) throw new Error('No active tab is available.');
  return tab.id;
}

export function renderTabActions(
  setStatus: (message: string) => void,
  summarizerEnabled: boolean,
): HTMLElement {
  const section = document.createElement('section');
  section.className = 'panel current-tab-panel';
  const eyebrow = document.createElement('p');
  eyebrow.className = 'eyebrow';
  eyebrow.textContent = 'Quick actions';
  const title = document.createElement('h2');
  title.textContent = 'Use Linchpin on this tab';
  const actions = document.createElement('div');
  actions.className = 'actions';

  const summarize = document.createElement('button');
  summarize.type = 'button';
  summarize.className = 'primary';
  summarize.textContent = 'Summarize this tab';
  summarize.disabled = !summarizerEnabled;
  summarize.title = summarizerEnabled ? '' : 'Enable the AI summarizer below first.';
  summarize.addEventListener('click', async () => {
    try {
      const tabId = await activeTabId();
      const url = new URL(browser.runtime.getURL('/summary.html' as never));
      url.searchParams.set('tabId', String(tabId));
      await browser.tabs.create({ url: url.href });
      window.close();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not open the summary page.');
    }
  });

  const pip = document.createElement('button');
  pip.type = 'button';
  pip.textContent = 'Picture in Picture';
  pip.addEventListener('click', async () => {
    pip.disabled = true;
    try {
      const tabId = await activeTabId();
      const results = await browser.scripting.executeScript({
        target: { tabId },
        func: requestPictureInPictureForBestVideo,
      });
      const result = results[0]?.result;
      if (!result?.ok) throw new Error(result?.error || 'Picture in Picture failed.');
      window.close();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Picture in Picture is unavailable on this page.');
    } finally {
      pip.disabled = false;
    }
  });

  actions.append(summarize, pip);
  section.append(eyebrow, title, actions);
  return section;
}
