import type { AccountStore } from '../types';
import {
  accountPublicSummary,
  getAccountStore,
  watchAccounts,
} from '../storage';
import { detectRedditUi } from './detect';
import type { RivetMessage } from '../accounts/messages';

const ROOT_ID = 'rivet-account-switcher';

async function send<T>(msg: RivetMessage): Promise<T> {
  return browser.runtime.sendMessage(msg) as Promise<T>;
}

function queryDeep<T extends Element>(
  root: ParentNode,
  selector: string,
): T | null {
  const direct = root.querySelector<T>(selector);
  if (direct) return direct;
  const hosts = root.querySelectorAll<HTMLElement>('*');
  for (const host of hosts) {
    if (!host.shadowRoot) continue;
    const found = queryDeep<T>(host.shadowRoot, selector);
    if (found) return found;
  }
  return null;
}

function findOldRedditAnchor(): HTMLElement | null {
  const right = document.getElementById('header-bottom-right');
  if (right) return right;
  const user = document.querySelector<HTMLElement>(
    '#header .user, .user a[href*="/user/"]',
  );
  return user?.parentElement ?? null;
}

/** Advertise / AD control — preferred insert-before target on new Reddit. */
function findAdvertiseControl(): HTMLElement | null {
  const selectors = [
    'a[href*="advertise.reddit" i]',
    'a[href*="/advertise" i]',
    'a[href*="ads.reddit" i]',
    'button[aria-label*="advertise" i]',
    'a[aria-label*="advertise" i]',
    '[aria-label*="Advertise" i]',
  ];
  for (const sel of selectors) {
    const el = queryDeep<HTMLElement>(document, sel);
    if (el && el.getBoundingClientRect().width > 0) return el;
  }
  return null;
}

function findNewRedditUserControl(): HTMLElement | null {
  const selectors = [
    '#expand-user-drawer-button',
    'button#USER_DROPDOWN_ID',
    '[id*="USER_DROPDOWN"]',
    'faceplate-tracker[source="user_dropdown"]',
  ];
  for (const sel of selectors) {
    const el = queryDeep<HTMLElement>(document, sel);
    if (el) return el;
  }
  return null;
}

type Placement = 'in-flow-ad' | 'in-flow-user' | 'fixed' | 'old';

function styleAsInFlow(root: HTMLElement): void {
  root.style.cssText = [
    'display:inline-flex',
    'flex:0 0 auto',
    'align-items:center',
    'justify-content:center',
    'align-self:center',
    'position:relative',
    'margin:0 8px 0 0',
    'padding:0',
    'border:0',
    'background:transparent',
    'line-height:0',
    'vertical-align:middle',
    'height:40px',
    'z-index:2147483000',
  ].join(';');
}

/**
 * Climb out of faceplate-tracker / tooltip wrappers so we insert as a sibling
 * of the whole Advertise control — not inside it (that steals the tooltip anchor).
 */
function advertiseUnitHost(ad: HTMLElement): HTMLElement {
  let node: HTMLElement = ad;
  for (let i = 0; i < 8; i++) {
    const parent = node.parentElement;
    if (!parent) return node;

    // Trailing icon row / header — stop; `node` is the unit to insert before
    if (
      parent.matches(
        'header, [slot="trailing"], reddit-header-large, nav, [role="navigation"]',
      ) ||
      parent.getAttribute('slot') === 'trailing'
    ) {
      return node;
    }

    const tag = parent.tagName.toLowerCase();
    const isInnerWrapper =
      tag.includes('faceplate') ||
      tag.includes('tooltip') ||
      tag.includes('tracker') ||
      tag.includes('dropdown') ||
      parent.childElementCount <= 2;

    // Parent looks like the multi-icon flex row (Create, Chat, AD, …)
    const siblingControls = parent.querySelectorAll(
      'a[href*="advertise" i], button[aria-label*="chat" i], a[href*="chat" i], button[aria-label*="create" i], #expand-user-drawer-button',
    );
    if (siblingControls.length >= 2 && !isInnerWrapper) {
      return node;
    }

    if (isInnerWrapper) {
      node = parent;
      continue;
    }

    return node;
  }
  return node;
}

/** True when Rivet is connected and immediately before the Advertise *unit* host. */
function isPlacedBeforeAdvertise(root: HTMLElement, ad: HTMLElement | null): boolean {
  if (!ad || !root.isConnected) return false;
  const unit = advertiseUnitHost(ad);
  return root.parentElement === unit.parentElement && root.nextElementSibling === unit;
}

/**
 * Insert into the trailing flex row as previous sibling of the Advertise unit
 * (outside faceplate wrappers so AD tooltips keep their own anchor).
 */
function mountInFlowBeforeAdvertise(root: HTMLElement): boolean {
  const ad = findAdvertiseControl();
  if (!ad) return false;
  const unit = advertiseUnitHost(ad);
  const parent = unit.parentElement;
  if (!parent) return false;

  // If we somehow ended up inside the AD unit, pull out first
  if (unit.contains(root) && root !== unit) {
    root.remove();
  }

  styleAsInFlow(root);
  if (!isPlacedBeforeAdvertise(root, ad)) {
    parent.insertBefore(root, unit);
  }
  return isPlacedBeforeAdvertise(root, ad);
}

function mountInFlowBeforeUser(root: HTMLElement): boolean {
  const user = findNewRedditUserControl();
  if (!user?.parentElement) return false;

  // Prefer the leftmost sibling group: walk up one level if advertise lives nearby
  const parent = user.parentElement;
  const adInParent = Array.from(parent.children).find((el) => {
    const href = (el as HTMLElement).getAttribute?.('href') || '';
    const label = (el as HTMLElement).getAttribute?.('aria-label') || '';
    return /advertise/i.test(href) || /advertise/i.test(label);
  }) as HTMLElement | undefined;

  styleAsInFlow(root);
  if (adInParent) {
    parent.insertBefore(root, adInParent);
  } else {
    // Insert as first child of the trailing actions row
    parent.insertBefore(root, parent.firstChild);
  }
  return root.isConnected && root.parentElement === parent;
}

function mountFixedFallback(root: HTMLElement): void {
  // Last resort only — reserve space visually by parking left of AD with measured width
  if (root.parentElement !== document.documentElement) {
    document.documentElement.appendChild(root);
  }
  const ad = findAdvertiseControl() || findNewRedditUserControl();
  const width = Math.max(root.getBoundingClientRect().width || 120, 120);
  const gap = 10;
  if (ad) {
    const rect = ad.getBoundingClientRect();
    const top = Math.max(6, rect.top + rect.height / 2 - 15);
    const left = Math.max(8, rect.left - gap - width);
    root.style.cssText = [
      'position:fixed',
      `top:${top}px`,
      `left:${left}px`,
      'right:auto',
      'margin:0',
      'padding:0',
      'border:0',
      'background:transparent',
      'z-index:2147483000',
      'line-height:1',
    ].join(';');
  } else {
    root.style.cssText =
      'position:fixed;top:10px;right:280px;z-index:2147483000;margin:0;';
  }
}

function mountOldReddit(root: HTMLElement): void {
  root.style.cssText =
      'display:inline-flex;align-items:center;margin:0 8px;vertical-align:middle;position:relative;z-index:2147483000;';
  const anchor = findOldRedditAnchor();
  if (anchor && root.parentElement !== anchor) {
    const user = anchor.querySelector('.user');
    if (user) anchor.insertBefore(root, user);
    else anchor.appendChild(root);
  } else if (!anchor && !root.isConnected) {
    document.documentElement.appendChild(root);
  }
}

/**
 * Place (or re-place) an existing root host. Does not create elements or touch shadow UI.
 * Returns the placement mode used.
 */
function placeRoot(root: HTMLElement): Placement {
  const ui = detectRedditUi();
  if (ui === 'old') {
    mountOldReddit(root);
    return 'old';
  }

  // New Reddit: prefer in-flow before Advertise (pushes header icons right)
  if (mountInFlowBeforeAdvertise(root)) return 'in-flow-ad';
  if (mountInFlowBeforeUser(root)) return 'in-flow-user';
  mountFixedFallback(root);
  return 'fixed';
}

/** Create the host element if needed. Prefer the stable closure ref over getElementById. */
function getOrCreateRoot(existing: HTMLElement | null): HTMLElement {
  if (existing) return existing;
  // Light-DOM only — cannot see shadow-hosted nodes; fine as a bootstrap fallback.
  const light = document.getElementById(ROOT_ID);
  if (light) return light;
  const root = document.createElement('div');
  root.id = ROOT_ID;
  return root;
}

function renderPanel(
  shadow: ShadowRoot,
  store: AccountStore,
  busy: boolean,
): void {
  const summaries = store.accounts.map(accountPublicSummary);
  const active = store.activeAccountId
    ? summaries.find((a) => a.id === store.activeAccountId)
    : null;
  const label = active ? active.label : 'Accounts';

  const sessionHint = (status: string): string => {
    if (status === 'expired') return 'Session expired';
    if (status === 'saved' || status === 'active') return 'Session saved';
    return 'No session yet';
  };

  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      * { box-sizing: border-box; font-family: "IBM Plex Sans", "Segoe UI", system-ui, sans-serif; }
      .wrap {
        position: relative;
        display: inline-flex;
        align-items: center;
        height: 40px;
      }
      .btn {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        max-width: 148px;
        height: 32px;
        padding: 0 10px;
        margin: 0;
        border-radius: 999px;
        border: 1px solid rgba(196, 92, 38, 0.5);
        background: linear-gradient(180deg, #fff4ec 0%, #fde6d6 100%);
        color: #8a3d14;
        font: 600 12px/1 inherit;
        cursor: pointer;
        box-shadow: 0 1px 2px rgba(196, 92, 38, 0.16);
        white-space: nowrap;
        transform: translateY(-1px);
      }
      .btn:hover {
        background: linear-gradient(180deg, #fff8f3 0%, #fcd9c0 100%);
        border-color: rgba(196, 92, 38, 0.7);
      }
      .btn[disabled] { opacity: 0.6; cursor: wait; }
      .name {
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 72px;
      }
      .chev { opacity: 0.55; font-size: 10px; flex-shrink: 0; }
      /* popover → top layer, above Reddit header tooltips */
      .menu {
        position: fixed;
        inset: unset;
        margin: 0;
        width: 260px;
        background: #fff;
        color: #1a1917;
        border: 1px solid #e4ddd3;
        border-radius: 12px;
        box-shadow: 0 12px 32px rgba(28, 27, 25, 0.18);
        padding: 6px;
      }
      .head {
        font: 600 11px/1.2 inherit;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: #8a847a;
        padding: 10px 10px 8px;
      }
      .list { display: flex; flex-direction: column; gap: 2px; }
      .item {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 10px;
        border-radius: 8px;
        background: transparent;
      }
      .item.current {
        background: #fff6ef;
      }
      .top {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 10px;
      }
      .meta { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
      .label {
        font: 650 14px/1.25 inherit;
        color: #1a1917;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .sub {
        font: 400 12px/1.3 inherit;
        color: #7a746c;
      }
      .sub.warn { color: #b3261e; }
      .badge {
        flex-shrink: 0;
        font: 650 11px/1 inherit;
        padding: 4px 8px;
        border-radius: 999px;
        background: #e8f5e9;
        color: #1b5e20;
      }
      .actions { display: flex; gap: 6px; flex-wrap: wrap; }
      .action {
        font: 600 12px/1 inherit;
        padding: 7px 11px;
        border-radius: 8px;
        border: 1px solid #e4ddd3;
        background: #fff;
        color: #1a1917;
        cursor: pointer;
      }
      .action:hover { background: #f7f4ef; }
      .action.primary {
        border-color: rgba(196, 92, 38, 0.45);
        background: #c45c26;
        color: #fff;
      }
      .action.primary:hover { filter: brightness(1.05); }
      .action:disabled {
        opacity: 0.55;
        cursor: default;
      }
      .empty {
        padding: 14px 10px;
        color: #7a746c;
        font: 13px/1.4 inherit;
      }
      .status {
        margin: 4px 4px 2px;
        padding: 8px 10px;
        border-radius: 8px;
        font: 12px/1.35 inherit;
        background: #f6f5f2;
        color: #5c574f;
      }
      .status.err { background: #ffebee; color: #b71c1c; }
      .status.ok { background: #e8f5e9; color: #1b5e20; }
    </style>
    <div class="wrap">
      <button type="button" class="btn" id="toggle" ${busy ? 'disabled' : ''} title="Rivet account switcher">
        <span>Rivet</span>
        <span class="name">${escapeHtml(label)}</span>
        <span class="chev">▾</span>
      </button>
      <div class="menu" id="menu" role="menu" popover="auto">
        <div class="head">Accounts</div>
        <div class="list">
        ${
          summaries.length
            ? summaries
                .map((a) => {
                  const isCurrent = a.id === store.activeAccountId;
                  const expired = a.sessionStatus === 'expired';
                  const hint = sessionHint(a.sessionStatus);
                  const userLine = a.username ? `u/${a.username}` : null;
                  return `
                  <div class="item ${isCurrent ? 'current' : ''}" data-account="${escapeHtml(a.id)}">
                    <div class="top">
                      <div class="meta">
                        <div class="label">${escapeHtml(a.label)}</div>
                        <div class="sub ${expired ? 'warn' : ''}">
                          ${userLine ? `${escapeHtml(userLine)} · ` : ''}${escapeHtml(hint)}
                        </div>
                      </div>
                      ${isCurrent ? '<span class="badge">Current</span>' : ''}
                    </div>
                    ${
                      isCurrent && !a.hasTotp
                        ? ''
                        : `<div class="actions">
                      ${
                        isCurrent
                          ? ''
                          : `<button type="button" class="action primary" data-switch="${escapeHtml(a.id)}" ${busy ? 'disabled' : ''}>Switch</button>`
                      }
                      ${
                        a.hasTotp
                          ? `<button type="button" class="action" data-totp="${escapeHtml(a.id)}" ${busy ? 'disabled' : ''}>Copy TOTP</button>`
                          : ''
                      }
                    </div>`
                    }
                  </div>`;
                })
                .join('')
            : `<div class="empty">No accounts yet. Add one in the Rivet popup, then capture a session.</div>`
        }
        </div>
        <div class="status" id="status" hidden></div>
      </div>
    </div>
  `;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function setStatus(shadow: ShadowRoot, text: string, kind: 'ok' | 'err' | '' = ''): void {
  const el = shadow.getElementById('status');
  if (!el) return;
  if (!text) {
    el.hidden = true;
    el.textContent = '';
    el.className = 'status';
    return;
  }
  el.hidden = false;
  el.textContent = text;
  el.className = `status${kind ? ` ${kind}` : ''}`;
}

/**
 * Account switcher next to Reddit's user/advertise controls.
 * New Reddit: insert in-flow before Advertise so icons shift right (no overlay).
 */
export function startAccountMenu(): () => void {
  let store: AccountStore = { accounts: [], activeAccountId: null };
  let busy = false;
  let open = false;
  let shadow: ShadowRoot | null = null;
  /** Stable host reference — source of truth for "is mounted" (survives shadow insertion). */
  let root: HTMLElement | null = null;
  let placement: Placement | null = null;
  let disposed = false;
  let ensureTimer: number | undefined;

  const ensureShadow = (): void => {
    if (!root) return;
    if (!root.shadowRoot) {
      shadow = root.attachShadow({ mode: 'open' });
    } else {
      shadow = root.shadowRoot;
    }
  };

  /** Reposition only — no shadow rebuild / paint. */
  const reposition = (): void => {
    if (disposed || !root) return;
    placement = placeRoot(root);
  };

  /** Full mount: create host if needed, place, ensure shadow, paint UI. */
  const remount = (): void => {
    if (disposed) return;
    root = getOrCreateRoot(root);
    // Drop light-DOM orphans that aren't our stable host
    const light = document.getElementById(ROOT_ID);
    if (light && light !== root) light.remove();
    placement = placeRoot(root);
    ensureShadow();
    paint();
  };

  /**
   * Observer-driven ensure:
   * - Remount when root is missing/disconnected
   * - Reposition (no rebuild) when in-flow aim is wrong or fixed needs refresh/upgrade
   * - No-op when already correctly before Advertise or stably placed
   */
  const ensure = (): void => {
    if (disposed) return;

    if (!root?.isConnected) {
      remount();
      return;
    }

    const ad = findAdvertiseControl();

    // Ideal: connected and immediately before Advertise
    if (isPlacedBeforeAdvertise(root, ad)) {
      placement = 'in-flow-ad';
      return;
    }

    // Stable fixed fallback: never full-remount just because we aren't AD's sibling.
    // Still try upgrade to in-flow, else refresh fixed coords only.
    if (placement === 'fixed') {
      if (ad?.parentElement && mountInFlowBeforeAdvertise(root)) {
        placement = 'in-flow-ad';
        return;
      }
      if (mountInFlowBeforeUser(root)) {
        placement = 'in-flow-user';
        return;
      }
      mountFixedFallback(root);
      return;
    }

    // Aiming for in-flow: reposition when Advertise exists and Rivet is not immediately before it
    if (ad && !isPlacedBeforeAdvertise(root, ad)) {
      reposition();
      return;
    }

    // No Advertise yet — keep in-flow-user if already there; otherwise place
    if (placement === 'in-flow-user') return;
    reposition();
  };

  const scheduleEnsure = (): void => {
    if (disposed) return;
    if (ensureTimer) window.clearTimeout(ensureTimer);
    ensureTimer = window.setTimeout(() => {
      ensureTimer = undefined;
      ensure();
    }, 80);
  };

  const paint = () => {
    if (!shadow) return;
    const wasOpen = open;
    renderPanel(shadow, store, busy);
    bind(shadow);
    if (wasOpen) {
      const menu = shadow.getElementById('menu');
      const toggle = shadow.getElementById('toggle');
      if (menu && 'showPopover' in menu) {
        try {
          (menu as HTMLElement & { showPopover: () => void }).showPopover();
          if (toggle) positionMenu(toggle, menu);
        } catch {
          /* ignore */
        }
      }
    }
  };

  const dismissRedditTooltips = (): void => {
    document
      .querySelectorAll<HTMLElement>(
        '[role="tooltip"], faceplate-tooltip, [id*="tooltip" i], [class*="tooltip" i]',
      )
      .forEach((el) => {
        // Only hide ephemeral floating tips, not whole widgets
        const r = el.getBoundingClientRect();
        if (r.width < 420 && r.height < 120) {
          el.hidden = true;
          el.style.setProperty('display', 'none', 'important');
        }
      });
    const ae = document.activeElement;
    if (ae instanceof HTMLElement) ae.blur();
  };

  const positionMenu = (toggle: Element, menu: HTMLElement): void => {
    const r = toggle.getBoundingClientRect();
    const width = 260;
    const left = Math.min(
      Math.max(8, r.right - width),
      window.innerWidth - width - 8,
    );
    menu.style.top = `${Math.round(r.bottom + 8)}px`;
    menu.style.left = `${Math.round(left)}px`;
  };

  const bind = (s: ShadowRoot) => {
    const menu = s.getElementById('menu');
    const toggle = s.getElementById('toggle');

    menu?.addEventListener('toggle', (e) => {
      const te = e as ToggleEvent;
      open = te.newState === 'open';
      if (open && toggle && menu) {
        positionMenu(toggle, menu);
      }
    });

    toggle?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      if (!menu || !('showPopover' in menu)) return;
      const pop = menu as HTMLElement & {
        showPopover: () => void;
        hidePopover: () => void;
        matches: (sel: string) => boolean;
      };
      if (pop.matches(':popover-open')) {
        pop.hidePopover();
      } else {
        dismissRedditTooltips();
        if (toggle) positionMenu(toggle, menu);
        pop.showPopover();
      }
    });

    s.querySelectorAll<HTMLButtonElement>('[data-switch]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const id = btn.dataset.switch;
        if (!id || busy) return;
        busy = true;
        paint();
        setStatus(s, 'Switching…');
        try {
          const result = await send<{
            ok: boolean;
            message?: string;
            needsRelogin?: boolean;
          }>({ type: 'rivet:switch-account', accountId: id });
          if (!result.ok) {
            setStatus(s, result.message || 'Switch failed', 'err');
          } else if (result.needsRelogin) {
            setStatus(
              s,
              result.message || 'Session may be expired — use TOTP + login',
              'err',
            );
          } else {
            setStatus(s, result.message || 'Switched — reloading Reddit…', 'ok');
            open = false;
            try {
              (menu as HTMLElement & { hidePopover?: () => void })?.hidePopover?.();
            } catch {
              /* ignore */
            }
          }
        } catch (err) {
          setStatus(
            s,
            err instanceof Error ? err.message : 'Switch failed',
            'err',
          );
        } finally {
          busy = false;
          store = await getAccountStore();
          paint();
        }
      });
    });

    s.querySelectorAll<HTMLButtonElement>('[data-totp]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const id = btn.dataset.totp;
        if (!id || busy) return;
        try {
          const result = await send<{
            ok: boolean;
            code?: string;
            remaining?: number;
            error?: string;
          }>({ type: 'rivet:totp', accountId: id });
          if (!result.ok || !result.code) {
            setStatus(s, result.error || 'No TOTP', 'err');
            return;
          }
          try {
            await navigator.clipboard.writeText(result.code);
            setStatus(
              s,
              `TOTP ${result.code} copied (${result.remaining ?? '?'}s)`,
              'ok',
            );
          } catch {
            setStatus(s, `TOTP ${result.code} (${result.remaining ?? '?'}s)`, 'ok');
          }
        } catch (err) {
          setStatus(
            s,
            err instanceof Error ? err.message : 'TOTP failed',
            'err',
          );
        }
      });
    });
  };

  const onDocClick = (e: MouseEvent) => {
    if (!open || !root || !shadow) return;
    const path = e.composedPath();
    if (path.includes(root)) return;
    const menu = shadow.getElementById('menu');
    if (menu && path.includes(menu)) return;
    open = false;
    try {
      (menu as HTMLElement & { hidePopover?: () => void })?.hidePopover?.();
    } catch {
      /* ignore */
    }
  };

  const headerObserver = new MutationObserver(() => {
    if (disposed) return;

    // Cheap pre-check using stable root ref (not getElementById — misses shadow hosts)
    if (!root?.isConnected) {
      scheduleEnsure();
      return;
    }

    const ad = findAdvertiseControl();
    if (isPlacedBeforeAdvertise(root, ad)) return;

    // Fixed mode: only schedule to try upgrade / refresh coords — never treat as missing
    if (placement === 'fixed') {
      scheduleEnsure();
      return;
    }

    // Aiming for in-flow: Advertise exists and Rivet is not immediately before it
    if (ad && !isPlacedBeforeAdvertise(root, ad)) {
      scheduleEnsure();
      return;
    }

    // Lost a known in-flow-user parent, or never placed
    if (placement !== 'in-flow-user' && placement !== 'old') {
      scheduleEnsure();
    }
  });

  void (async () => {
    store = await getAccountStore();
    remount();
  })();

  const unwatch = watchAccounts((next) => {
    store = next;
    paint();
  });

  document.addEventListener('click', onDocClick, true);
  headerObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  return () => {
    disposed = true;
    unwatch();
    document.removeEventListener('click', onDocClick, true);
    headerObserver.disconnect();
    if (ensureTimer) window.clearTimeout(ensureTimer);
    // Prefer stable ref — getElementById cannot see shadow-hosted nodes
    root?.remove();
    document.getElementById(ROOT_ID)?.remove();
    root = null;
    shadow = null;
    placement = null;
  };
}
