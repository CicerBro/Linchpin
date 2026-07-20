const STYLE_ID = 'linchpin-youtube-shorts-style';

const SHORTS_CSS = `
/* Shelves and grids */
ytd-reel-shelf-renderer,
ytd-rich-shelf-renderer[is-shorts],
ytm-shorts-lockup-view-model,
grid-shelf-view-model:has(a[href^="/shorts/"]) {
  display: none !important;
}

/* Home, subscriptions, and search result cards */
ytd-video-renderer:has(a[href^="/shorts/"]),
ytd-grid-video-renderer:has(a[href^="/shorts/"]),
ytd-rich-item-renderer:has(a[href^="/shorts/"]),
yt-lockup-view-model:has(a[href^="/shorts/"]) {
  display: none !important;
}

/* Sidebar and filter chips */
ytd-guide-entry-renderer:has(a[href^="/shorts"]),
ytd-mini-guide-entry-renderer:has(a[href^="/shorts"]),
yt-chip-cloud-chip-renderer:has(a[href^="/shorts"]),
yt-tab-shape:has(a[href^="/shorts"]) {
  display: none !important;
}
`;

function watchUrlForShortId(url: URL): string | null {
  const match = /^\/shorts\/([A-Za-z0-9_-]{6,})(?:\/|$)/.exec(url.pathname);
  return match?.[1] ?? null;
}

function redirectShortsRoute(): void {
  const current = new URL(location.href);
  const videoId = watchUrlForShortId(current);
  if (!videoId) return;
  const target = new URL('/watch', current.origin);
  target.searchParams.set('v', videoId);
  for (const name of ['list', 'index', 't', 'start']) {
    const value = current.searchParams.get(name);
    if (value) target.searchParams.set(name, value);
  }
  if (target.href !== current.href) location.replace(target.href);
}

function installStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.setAttribute('data-linchpin-ui', 'youtube-shorts');
  style.textContent = SHORTS_CSS;
  document.documentElement.append(style);
}

export function startYouTubeShortsRemoval(): () => void {
  installStyles();
  redirectShortsRoute();

  const onNavigate = () => redirectShortsRoute();
  document.addEventListener('yt-navigate-finish', onNavigate);
  window.addEventListener('popstate', onNavigate);

  return () => {
    document.removeEventListener('yt-navigate-finish', onNavigate);
    window.removeEventListener('popstate', onNavigate);
    document.getElementById(STYLE_ID)?.remove();
    for (const marked of document.querySelectorAll('[data-linchpin-shorts-hidden]')) {
      marked.removeAttribute('data-linchpin-shorts-hidden');
    }
  };
}
