import {
  getSettings,
  getSubredditVisits,
  getTags,
  watchSettings,
  watchSubredditVisits,
  watchTags,
} from '../lib/storage';
import type { Settings, SubredditVisitMap, UserTagMap } from '../lib/types';
import { applyTagsToDocument } from '../lib/reddit/applyTags';
import { applyIgnoreHides } from '../lib/reddit/hideIgnored';
import { logUiDetectionOnce } from '../lib/reddit/detect';
import { startOldRedditInfiniteScroll } from '../lib/reddit/infiniteScroll';
import {
  refreshSubredditVisitBadges,
  startSubredditLastVisited,
} from '../lib/reddit/subredditVisits';
import { startNewCommentCounts } from '../lib/reddit/newCommentCount';
import { startAccountMenu } from '../lib/reddit/accountMenu';

/** Soft-nav detection: popstate + patched pushState/replaceState (no polling). */
function watchUrlChanges(onChange: (url: string) => void): () => void {
  let last = location.href;

  const notifyIfChanged = () => {
    const next = location.href;
    if (next === last) return;
    last = next;
    onChange(next);
  };

  const origPush = history.pushState.bind(history);
  const origReplace = history.replaceState.bind(history);

  history.pushState = function (
    ...args: Parameters<History['pushState']>
  ): void {
    origPush(...args);
    notifyIfChanged();
  };

  history.replaceState = function (
    ...args: Parameters<History['replaceState']>
  ): void {
    origReplace(...args);
    notifyIfChanged();
  };

  window.addEventListener('popstate', notifyIfChanged);

  return () => {
    history.pushState = origPush;
    history.replaceState = origReplace;
    window.removeEventListener('popstate', notifyIfChanged);
  };
}

export default defineContentScript({
  matches: ['*://*.reddit.com/*'],
  runAt: 'document_idle',
  main() {
    const ui = logUiDetectionOnce();

    let tags: UserTagMap = {};
    let settings: Settings | null = null;
    let subVisits: SubredditVisitMap = {};
    let stopScroll: (() => void) | null = null;
    let stopSubVisits: (() => void) | null = null;
    let stopNcc: (() => void) | null = null;
    startAccountMenu();

    const refresh = (root: ParentNode = document) => {
      if (!settings) return;
      applyTagsToDocument(tags, settings, root);
      applyIgnoreHides(tags, settings, root);
      refreshSubredditVisitBadges(subVisits, settings, root);
    };

    const restartScroll = () => {
      stopScroll?.();
      stopScroll = null;
      if (!settings?.enableOldRedditInfiniteScroll) return;
      if (ui !== 'old' && logUiDetectionOnce() !== 'old') return;
      stopScroll = startOldRedditInfiniteScroll((nodes) => {
        for (const node of nodes) {
          refresh(node);
        }
      });
    };

    const restartP3 = () => {
      stopSubVisits?.();
      stopNcc?.();
      stopSubVisits = null;
      stopNcc = null;
      if (!settings) return;
      stopSubVisits = startSubredditLastVisited(settings);
      stopNcc = startNewCommentCounts(settings);
    };

    void (async () => {
      tags = await getTags();
      settings = await getSettings();
      subVisits = await getSubredditVisits();
      refresh();
      restartScroll();
      restartP3();
    })();

    watchTags((next) => {
      tags = next;
      refresh();
    });

    watchSettings((next) => {
      settings = next;
      refresh();
      restartScroll();
      restartP3();
    });

    watchSubredditVisits((next) => {
      subVisits = next;
      if (settings) refreshSubredditVisitBadges(subVisits, settings);
    });

    watchUrlChanges(() => {
      // Soft nav: restart listing scroll + last-visited / new-comment controllers
      restartScroll();
      restartP3();
      refresh();
    });

    const observer = new MutationObserver((mutations) => {
      if (!settings) return;
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          const el = node as Element;
          if (
            el.id === 'rivet-account-switcher' ||
            el.classList?.contains('rivet-badge') ||
            el.classList?.contains('rivet-ignored-bar') ||
            el.classList?.contains('rivet-sub-visit-badge') ||
            el.id === 'rivet-ner-indicator' ||
            el.id === 'rivet-hide-styles' ||
            el.id === 'rivet-subreddit-last-visited' ||
            el.id === 'rivet-new-comment-banner'
          ) {
            continue;
          }
          refresh(el);
        }
      }
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  },
});
