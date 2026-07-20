const REDDIT_NAV_EVENTS = ['reddit:navigation', 'reddit-page-changed', 'shreddit:page-changed'];

/** Reddit SPA navigation with site events first and History/popstate fallback. */
export function watchNavigation(onChange: (url: URL) => void): () => void {
  let last = location.href;
  const notify = () => {
    if (location.href === last) return;
    last = location.href;
    onChange(new URL(last));
  };

  const originalPush = history.pushState;
  const originalReplace = history.replaceState;
  history.pushState = function (...args) {
    originalPush.apply(this, args);
    notify();
  };
  history.replaceState = function (...args) {
    originalReplace.apply(this, args);
    notify();
  };

  window.addEventListener('popstate', notify);
  for (const event of REDDIT_NAV_EVENTS) window.addEventListener(event, notify);

  return () => {
    history.pushState = originalPush;
    history.replaceState = originalReplace;
    window.removeEventListener('popstate', notify);
    for (const event of REDDIT_NAV_EVENTS) window.removeEventListener(event, notify);
  };
}
