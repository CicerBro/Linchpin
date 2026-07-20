import type { FeatureController, RootFeatureController } from '../lib/core/feature';
import { Lifecycle } from '../lib/core/lifecycle';
import { createMutationBatch } from '../lib/core/mutationBatch';
import { watchNavigation } from '../lib/core/navigation';
import {
  getSettings,
  getSubredditVisits,
  getTags,
  watchSettings,
  watchSubredditVisits,
  watchTags,
} from '../lib/storage';
import type { FeatureSettings, SubredditVisitMap, UserTagMap } from '../lib/types';
import { applyTagsToDocument } from '../lib/reddit/applyTags';
import { applyIgnoreHides } from '../lib/reddit/hideIgnored';
import { logUiDetectionOnce } from '../lib/reddit/detect';
import { startOldRedditInfiniteScroll } from '../lib/reddit/infiniteScroll';
import {
  refreshSubredditVisitBadges,
  startSubredditLastVisited,
} from '../lib/reddit/subredditVisits';
import { startNewCommentCounts } from '../lib/reddit/newCommentCount';
import { startAccountMenu, type AccountMenuHandle } from '../lib/reddit/accountMenu';

type RestartableController = FeatureController & { restart(): void };

function createRootController(
  start: () => void,
  stop: () => void,
  process: (root: ParentNode) => void,
): RootFeatureController {
  let active = false;
  return {
    start() {
      if (active) return;
      active = true;
      start();
    },
    stop() {
      if (!active) return;
      active = false;
      stop();
    },
    process(root) {
      if (active) process(root);
    },
  };
}

function createRestartable(start: () => () => void): RestartableController {
  let cleanup: (() => void) | null = null;
  return {
    start() {
      if (!cleanup) cleanup = start();
    },
    stop() {
      cleanup?.();
      cleanup = null;
    },
    restart() {
      this.stop();
      this.start();
    },
  };
}

function isLinchpinElement(element: Element): boolean {
  return Boolean(
    element.closest(
      '#linchpin-account-switcher, .linchpin-badge, .linchpin-ignored-bar, .linchpin-sub-visit-badge, #linchpin-ner-indicator, #linchpin-hide-styles, #linchpin-subreddit-last-visited, #linchpin-new-comment-banner',
    ),
  );
}

export default defineContentScript({
  matches: ['*://*.reddit.com/*'],
  runAt: 'document_idle',
  main() {
    logUiDetectionOnce();
    const lifecycle = new Lifecycle();
    lifecycle.start();

    let settings: FeatureSettings | null = null;
    let tags: UserTagMap = {};
    let subredditVisits: SubredditVisitMap = {};
    let accountMenu: AccountMenuHandle | null = null;
    let stopSubredditRoute: (() => void) | null = null;
    let stopNewCommentsRoute: (() => void) | null = null;
    let disposed = false;

    const tagsController = createRootController(
      () => applyTagsToDocument(tags, settings!, document),
      () => {
        const disabled = { ...settings!, reddit: { ...settings!.reddit, tags: false } };
        applyTagsToDocument(tags, disabled, document);
        document.querySelectorAll('[data-linchpin-tag-signature]').forEach((element) => {
          element.removeAttribute('data-linchpin-tag-signature');
        });
      },
      (root) => applyTagsToDocument(tags, settings!, root),
    );

    const ignoreController = createRootController(
      () => applyIgnoreHides(tags, settings!, document),
      () => {
        const disabled = { ...settings!, reddit: { ...settings!.reddit, ignore: false } };
        applyIgnoreHides(tags, disabled, document);
      },
      (root) => applyIgnoreHides(tags, settings!, root),
    );

    const subredditController = createRootController(
      () => {
        stopSubredditRoute = startSubredditLastVisited(settings!);
      },
      () => {
        stopSubredditRoute?.();
        stopSubredditRoute = null;
        const disabled = { ...settings!, reddit: { ...settings!.reddit, subredditVisits: false } };
        refreshSubredditVisitBadges(subredditVisits, disabled, document);
      },
      (root) => refreshSubredditVisitBadges(subredditVisits, settings!, root),
    );

    const accountController = createRootController(
      () => {
        accountMenu = startAccountMenu();
      },
      () => {
        accountMenu?.();
        accountMenu = null;
      },
      (root) => accountMenu?.process(root),
    );

    const mutationControllers: RootFeatureController[] = [
      tagsController,
      ignoreController,
      subredditController,
      accountController,
    ];

    const batch = createMutationBatch((roots) => {
      for (const root of roots) {
        for (const controller of mutationControllers) controller.process(root);
      }
    });
    lifecycle.add(() => batch.stop());

    const scrollController = createRestartable(() =>
      startOldRedditInfiniteScroll((nodes) => {
        for (const node of nodes) batch.enqueue(node);
      }),
    );
    const newCommentsController = createRestartable(() => {
      stopNewCommentsRoute = startNewCommentCounts(settings!);
      return () => {
        stopNewCommentsRoute?.();
        stopNewCommentsRoute = null;
      };
    });

    const syncControllers = (previous: FeatureSettings | null) => {
      if (!settings) return;
      const sync = (
        changed: boolean,
        enabled: boolean,
        controller: FeatureController,
      ) => {
        if (!changed) return;
        controller.stop();
        if (enabled) void controller.start();
      };

      sync(!previous || previous.reddit.tags !== settings.reddit.tags || previous.reddit.tagBadgeStyle !== settings.reddit.tagBadgeStyle, settings.reddit.tags, tagsController);
      sync(!previous || previous.reddit.ignore !== settings.reddit.ignore, settings.reddit.ignore, ignoreController);
      sync(!previous || previous.reddit.subredditVisits !== settings.reddit.subredditVisits, settings.reddit.subredditVisits, subredditController);
      sync(!previous || previous.reddit.accountSwitcher !== settings.reddit.accountSwitcher, settings.reddit.accountSwitcher, accountController);
      sync(!previous || previous.reddit.infiniteScroll !== settings.reddit.infiniteScroll, settings.reddit.infiniteScroll, scrollController);
      sync(!previous || previous.reddit.newCommentCounts !== settings.reddit.newCommentCounts, settings.reddit.newCommentCounts, newCommentsController);
    };

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (!(node instanceof Element) || isLinchpinElement(node)) continue;
          batch.enqueue(node);
        }
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    lifecycle.add(() => observer.disconnect());

    lifecycle.add(
      watchNavigation(() => {
        if (!settings) return;
        if (settings.reddit.infiniteScroll) scrollController.restart();
        if (settings.reddit.newCommentCounts) newCommentsController.restart();
        if (settings.reddit.subredditVisits) {
          subredditController.stop();
          void subredditController.start();
        }
        for (const controller of mutationControllers) controller.process(document);
      }),
    );

    void (async () => {
      [tags, settings, subredditVisits] = await Promise.all([
        getTags(),
        getSettings(),
        getSubredditVisits(),
      ]);
      if (disposed) return;
      syncControllers(null);

      lifecycle.add(
        watchTags((next) => {
          tags = next;
          tagsController.process(document);
          ignoreController.process(document);
        }),
      );
      lifecycle.add(
        watchSettings((next) => {
          const previous = settings;
          settings = next;
          syncControllers(previous);
        }),
      );
      lifecycle.add(
        watchSubredditVisits((next) => {
          subredditVisits = next;
          subredditController.process(document);
        }),
      );
    })();

    const stopAll = () => {
      if (disposed) return;
      disposed = true;
      scrollController.stop();
      newCommentsController.stop();
      for (const controller of mutationControllers) controller.stop();
      lifecycle.stop();
    };
    window.addEventListener('pagehide', stopAll, { once: true });
    lifecycle.add(() => window.removeEventListener('pagehide', stopAll));
  },
});
