import { isSupportedGoogleHost } from './hosts';

const MAPS_CONTROL_ID = 'linchpin-google-maps-link';

function currentSearchQuery(): string | null {
  if (!isSupportedGoogleHost(location.hostname)) return null;
  const url = new URL(location.href);
  if (url.pathname !== '/search' && url.pathname !== '/') return null;
  if (url.searchParams.get('tbm') === 'isch' || url.searchParams.get('udm') === '2') {
    return null;
  }
  const query = url.searchParams.get('q')?.trim();
  return query || null;
}

function findTabExample(): HTMLAnchorElement | null {
  const selectors = [
    'a[href*="udm=2"]',
    'a[href*="tbm=isch"]',
  ];
  for (const selector of selectors) {
    const links = document.querySelectorAll<HTMLAnchorElement>(selector);
    for (const link of links) {
      const item = link.closest('[role="listitem"]');
      if (item?.parentElement?.getAttribute('role') === 'list') return link;
      if (link.closest('[role="navigation"], nav, #hdtb-sc, .MUFPAc')) return link;
    }
  }
  return null;
}

function removeGoogleInteractionMetadata(root: Element): void {
  for (const element of [root, ...root.querySelectorAll('*')]) {
    for (const attribute of [
      'id',
      'jsname',
      'jsaction',
      'data-hveid',
      'data-ved',
      'aria-current',
      'aria-disabled',
    ]) {
      element.removeAttribute(attribute);
    }
  }
}

function replaceTabLabel(link: HTMLAnchorElement, label: string): void {
  const descendants = [...link.querySelectorAll<HTMLElement>('*')];
  const leaf = descendants.findLast(
    (element) => element.childElementCount === 0 && Boolean(element.textContent?.trim()),
  );
  if (leaf) leaf.textContent = label;
  else link.textContent = label;
}

function tabNode(link: HTMLAnchorElement): HTMLElement {
  const item = link.closest<HTMLElement>('[role="listitem"]');
  return item?.parentElement?.getAttribute('role') === 'list' ? item : link;
}

function cloneTabAfter(example: HTMLAnchorElement, href: string): HTMLAnchorElement | null {
  const source = tabNode(example);
  const clone = source.cloneNode(true) as HTMLElement;
  removeGoogleInteractionMetadata(clone);

  const link = clone instanceof HTMLAnchorElement
    ? clone
    : clone.querySelector<HTMLAnchorElement>('a');
  if (!link) return null;
  link.id = MAPS_CONTROL_ID;
  link.href = href;
  link.setAttribute('data-linchpin-ui', 'google-maps');
  replaceTabLabel(link, 'Maps');
  source.insertAdjacentElement('afterend', clone);
  return link;
}

function mapsUrl(query: string): string {
  const url = new URL('https://www.google.com/maps/search/');
  url.searchParams.set('api', '1');
  url.searchParams.set('query', query);
  return url.href;
}

export function removeMapsButton(): void {
  document.getElementById(MAPS_CONTROL_ID)?.remove();
}

/** Idempotently creates or updates the Maps search tab. */
export function updateMapsButton(enabled: boolean): void {
  const query = enabled ? currentSearchQuery() : null;
  if (!query) {
    removeMapsButton();
    return;
  }

  const nextUrl = mapsUrl(query);
  const example = findTabExample();
  const existing = document.getElementById(MAPS_CONTROL_ID) as HTMLAnchorElement | null;
  if (existing) {
    if (existing.href !== nextUrl) existing.href = nextUrl;
    if (example && tabNode(existing).previousElementSibling !== tabNode(example)) {
      tabNode(existing).remove();
      cloneTabAfter(example, nextUrl);
    }
    return;
  }

  if (!example) return;
  cloneTabAfter(example, nextUrl);
}
