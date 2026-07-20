const SELECTOR = '#redesign-beta-optin, .redesign-beta-optin';

/**
 * Remove old Reddit's "Get New Reddit" / redesign beta opt-in control.
 * Runs against mutation roots so Reddit cannot reinject it later.
 */
export function removeRedesignOptIn(root: ParentNode = document): void {
  const matches: Element[] = [];

  if (root instanceof Element && root.matches(SELECTOR)) {
    matches.push(root);
  }

  matches.push(...Array.from(root.querySelectorAll?.(SELECTOR) ?? []));

  for (const el of matches) {
    el.remove();
  }
}
