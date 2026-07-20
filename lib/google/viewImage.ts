import { isSupportedGoogleHost } from './hosts';

const VIEW_IMAGE_CONTROL_ID = 'linchpin-google-view-image';

function isImageResultsPage(): boolean {
  if (!isSupportedGoogleHost(location.hostname)) return false;
  const url = new URL(location.href);
  return (
    url.pathname === '/search' &&
    (url.searchParams.get('tbm') === 'isch' || url.searchParams.get('udm') === '2')
  );
}

function safeHttpUrl(candidate: string | null | undefined): string | null {
  if (!candidate) return null;
  try {
    const url = new URL(candidate, location.href);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

/** Selectors are deliberately isolated because Google changes result markup often. */
function findSelectedImage(): HTMLImageElement | null {
  const selectors = [
    'img[jsname="kn3ccd"]',
    '[aria-selected="true"] img[data-iurl]',
    '[data-iurl][aria-selected="true"] img',
    'img[data-iurl][data-ilt]',
  ];
  for (const selector of selectors) {
    const images = document.querySelectorAll<HTMLImageElement>(selector);
    for (const image of images) {
      const rect = image.getBoundingClientRect();
      if (rect.width >= 160 && rect.height >= 120) return image;
    }
  }
  return null;
}

function urlFromImageResultLink(image: HTMLImageElement): string | null {
  const link =
    image.closest<HTMLAnchorElement>('a[href]') ??
    image.parentElement?.closest<HTMLAnchorElement>('a[href]');
  if (!link) return null;
  try {
    const resultUrl = new URL(link.href, location.href);
    return safeHttpUrl(resultUrl.searchParams.get('imgurl'));
  } catch {
    return null;
  }
}

function resolveOriginalImageUrl(image: HTMLImageElement): string | null {
  const holders: Element[] = [image, image.closest('[data-iurl]'), image.parentElement].filter(
    (element): element is Element => element !== null,
  );

  for (const holder of holders) {
    const direct = safeHttpUrl(
      holder.getAttribute('data-iurl') ?? holder.getAttribute('data-original-url'),
    );
    if (direct) return direct;
  }
  return urlFromImageResultLink(image) ?? safeHttpUrl(image.currentSrc || image.src);
}

export function removeViewImageButton(): void {
  document.getElementById(VIEW_IMAGE_CONTROL_ID)?.remove();
}

/** Updates one persistent action for the selected image; never adds duplicates. */
export function updateViewImageButton(enabled: boolean): void {
  if (!enabled || !isImageResultsPage()) {
    removeViewImageButton();
    return;
  }
  const selected = findSelectedImage();
  const imageUrl = selected ? resolveOriginalImageUrl(selected) : null;
  if (!imageUrl) {
    removeViewImageButton();
    return;
  }

  let link = document.getElementById(VIEW_IMAGE_CONTROL_ID) as HTMLAnchorElement | null;
  if (!link) {
    link = document.createElement('a');
    link.id = VIEW_IMAGE_CONTROL_ID;
    link.textContent = 'View image';
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.setAttribute('data-linchpin-ui', 'google-view-image');
    link.style.cssText = [
      'position:fixed',
      'right:20px',
      'bottom:20px',
      'z-index:2147483646',
      'padding:10px 14px',
      'border-radius:20px',
      'background:#202124',
      'color:#fff',
      'font:500 14px/20px Arial,sans-serif',
      'text-decoration:none',
      'box-shadow:0 2px 8px rgba(0,0,0,.3)',
    ].join(';');
    document.documentElement.append(link);
  }
  if (link.href !== imageUrl) link.href = imageUrl;
}
