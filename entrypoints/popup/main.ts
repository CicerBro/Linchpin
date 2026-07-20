import 'tom-select/dist/css/tom-select.default.css';
import './style.css';
import {
  buildSafeExport,
  deleteTag,
  getAccountStore,
  getAccountRecovery,
  getSettings,
  getSubredditVisits,
  getTags,
  getThreadVisits,
  mergeSubredditVisits,
  mergeTags,
  mergeThreadVisits,
  newAccountId,
  normalizeUsername,
  removeAccount,
  replaceSettings,
  updateSettings,
  upsertAccount,
  upsertTag,
} from '../../lib/storage';
import type { AccountStore, Settings, StoredAccount, UserTag, UserTagMap } from '../../lib/types';
import { parseResTagsText } from '../../lib/import/resTags';
import { buildLinchpinBackup, parseLinchpinBackupText } from '../../lib/import/linchpinBackup';
import { ensureResSeedImported } from '../../lib/import/ensureSeed';
import { maskSecret } from '../../lib/accounts/totp';
import type { LinchpinMessage } from '../../lib/accounts/messages';
import { renderTabActions } from './actions';
import { renderProviderSettings } from './providerSettings';
import { renderAccountsSection, renderTagForm, renderTagList } from './contentSections';

const app = document.querySelector<HTMLDivElement>('#app')!;

let tags: UserTagMap = {};
let settings: Settings;
let accounts: AccountStore = { accounts: [], activeAccountId: null };
let recoveryAvailable = false;
let search = '';
let editing: string | null = null;
let editingAccountId: string | null = null;
let statusMsg = '';
let totpDisplay: { accountId: string; code: string; remaining: number } | null = null;
let totpTimer: number | undefined;
let statusTimer: number | undefined;
let renderGeneration = 0;
type PopupView = 'tools' | 'reddit' | 'data';
let activeView: PopupView = 'tools';

function setStatus(msg: string): void {
  if (statusTimer != null) window.clearTimeout(statusTimer);
  statusMsg = msg;
  render();
  if (msg) {
    statusTimer = window.setTimeout(() => {
      statusTimer = undefined;
      if (statusMsg === msg) {
        statusMsg = '';
        render();
      }
    }, 3500);
  }
}

async function send<T>(msg: LinchpinMessage): Promise<T> {
  return browser.runtime.sendMessage(msg) as Promise<T>;
}

async function reload(): Promise<void> {
  const seed = await ensureResSeedImported();
  tags = await getTags();
  settings = await getSettings();
  accounts = await getAccountStore();
  recoveryAvailable = Boolean(await getAccountRecovery());
  if (seed.status === 'imported') {
    statusMsg = `Imported ${seed.added} RES tags from Brave seed`;
  }
  render();
}

function settingRow(options: {
  id: string;
  title: string;
  description: string;
  checked: boolean;
}): string {
  const { id, title, description, checked } = options;
  return `
    <label class="setting-row" for="${id}">
      <span class="setting-copy">
        <strong>${title}</strong>
        <span>${description}</span>
      </span>
      <input class="switch-input" type="checkbox" id="${id}" ${checked ? 'checked' : ''} />
    </label>
  `;
}

function redditSettingsHtml(): string {
  return `
    <section class="panel">
      <div class="section-heading">
        <div>
          <p class="eyebrow">On Reddit</p>
          <h2>Browsing features</h2>
        </div>
      </div>
      <div class="setting-list">
        ${settingRow({ id: 'enableTags', title: 'User tags', description: 'Show your labels beside Reddit usernames.', checked: settings.reddit.tags })}
        ${settingRow({ id: 'enableIgnore', title: 'Hide ignored users', description: 'Remove posts and comments from ignored accounts.', checked: settings.reddit.ignore })}
        ${settingRow({ id: 'enableAccountSwitcher', title: 'Account switcher', description: 'Switch saved sessions from Reddit’s account menu.', checked: settings.reddit.accountSwitcher })}
        ${settingRow({ id: 'enableScroll', title: 'Infinite scroll', description: 'Load more posts automatically on old Reddit.', checked: settings.reddit.infiniteScroll })}
        ${settingRow({ id: 'enableSubVisits', title: 'Visit hints', description: 'Show when you last opened a subreddit.', checked: settings.reddit.subredditVisits })}
        ${settingRow({ id: 'enableNcc', title: 'New comment counts', description: 'Track new replies since your last thread visit.', checked: settings.reddit.newCommentCounts })}
      </div>
      <label class="select-row">
        <span class="setting-copy"><strong>Tag appearance</strong><span>Choose how labels sit beside usernames.</span></span>
        <select id="badgeStyle">
          <option value="pill" ${settings.reddit.tagBadgeStyle === 'pill' ? 'selected' : ''}>Pill</option>
          <option value="text" ${settings.reddit.tagBadgeStyle === 'text' ? 'selected' : ''}>Text</option>
        </select>
      </label>
    </section>
  `;
}

function toolSettingsHtml(): string {
  return `
    <section class="panel">
      <div class="section-heading">
        <div>
          <p class="eyebrow">Around the web</p>
          <h2>Site tools</h2>
        </div>
      </div>
      <div class="setting-list">
        ${settingRow({ id: 'enableJson', title: 'JSON formatter', description: 'Turn raw JSON documents into a collapsible tree.', checked: settings.jsonFormatter.enabled })}
        ${settingRow({ id: 'enableMaps', title: 'Google Maps link', description: 'Restore Maps in Google search navigation.', checked: settings.google.mapsButton })}
        ${settingRow({ id: 'enableViewImage', title: 'Google View Image', description: 'Add direct image links to search previews.', checked: settings.google.viewImage })}
        ${settingRow({ id: 'enableShorts', title: 'Remove YouTube Shorts', description: 'Hide Shorts shelves and navigation entries.', checked: settings.youtube.removeShorts })}
      </div>
    </section>
    <section class="panel">
      <p class="eyebrow">JSON formatter</p>
      <h2>Display options</h2>
      <div class="setting-list json-setting-list">
        ${settingRow({ id: 'jsonArrayIndices', title: 'Array index keys', description: 'Prefix array elements with 0, 1, 2, and so on.', checked: settings.jsonFormatter.showArrayIndices })}
        <label class="setting-row control-row" for="jsonItemCountMode">
          <span class="setting-copy"><strong>Item counts</strong><span>Hide counts, always show them, or show only for large collections.</span></span>
          <select id="jsonItemCountMode" class="compact-control">
            <option value="hide" ${settings.jsonFormatter.itemCountMode === 'hide' ? 'selected' : ''}>Hide</option>
            <option value="show" ${settings.jsonFormatter.itemCountMode === 'show' ? 'selected' : ''}>Always show</option>
            <option value="threshold" ${settings.jsonFormatter.itemCountMode === 'threshold' ? 'selected' : ''}>Only above…</option>
          </select>
        </label>
        <label class="setting-row control-row" for="jsonItemCountThreshold">
          <span class="setting-copy"><strong>Count threshold</strong><span>Show counts when a collection has more than this many elements.</span></span>
          <input id="jsonItemCountThreshold" class="compact-control count-threshold" type="number" min="1" max="100000" step="1" value="${settings.jsonFormatter.itemCountThreshold}" ${settings.jsonFormatter.itemCountMode === 'threshold' ? '' : 'disabled'} />
        </label>
        <label class="setting-row control-row" for="jsonTheme">
          <span class="setting-copy"><strong>Theme</strong><span>Choose the formatter’s color scheme.</span></span>
          <select id="jsonTheme" class="compact-control">
            <option value="system" ${settings.jsonFormatter.darkMode === 'system' ? 'selected' : ''}>System</option>
            <option value="light" ${settings.jsonFormatter.darkMode === 'light' ? 'selected' : ''}>Light</option>
            <option value="dark" ${settings.jsonFormatter.darkMode === 'dark' ? 'selected' : ''}>Dark</option>
          </select>
        </label>
      </div>
    </section>
  `;
}

function importHtml(): string {
  return `
    <section class="panel import-panel">
      <p class="eyebrow">Portable and private</p>
      <h2>Import or export</h2>
      <p class="help">Paste a Linchpin backup or a RES tag export. Merges tags/visits; replaces settings when present. <strong>Never includes account cookies or TOTP secrets.</strong></p>
      <textarea id="import-json" rows="4" placeholder='{"settings":{…},"tags":{"username":{"text":"bot"}}}'></textarea>
      <div class="actions">
        <button type="button" id="import-btn" class="primary">Import</button>
        <button type="button" id="import-seed">Load seed tags</button>
        <button type="button" id="export-btn">Export Linchpin JSON</button>
        <button type="button" id="export-tags-btn">Export tags only</button>
      </div>
    </section>
  `;
}

function isSafeColor(value: string): boolean {
  return value.length <= 80 && !/[<>"'`;{}]/.test(value) && CSS.supports('color', value);
}

function render(): void {
  const generation = ++renderGeneration;
  const editTag = editing ? tags[editing] : undefined;
  app.innerHTML = `
    <header class="app-header">
      <div class="brand-row">
        <img class="brand-icon" src="/icon/48.png" width="34" height="34" alt="" />
        <div>
          <p class="eyebrow">Browser toolkit</p>
          <h1>Linchpin</h1>
        </div>
      </div>
      <nav class="app-nav" role="tablist" aria-label="Linchpin sections">
        <button type="button" role="tab" data-view="tools" aria-controls="view-tools">Tools</button>
        <button type="button" role="tab" data-view="reddit" aria-controls="view-reddit">Reddit</button>
        <button type="button" role="tab" data-view="data" aria-controls="view-data">Data</button>
      </nav>
    </header>
    <div id="status-slot" class="status-slot" aria-live="polite"></div>
    <main class="app-content">
      <section class="view-panel" id="view-tools" role="tabpanel" data-panel="tools">
        <div id="tab-actions-slot"></div>
        ${toolSettingsHtml()}
        <div id="provider-settings-slot"></div>
      </section>
      <section class="view-panel" id="view-reddit" role="tabpanel" data-panel="reddit">
        ${redditSettingsHtml()}
        <div id="accounts-slot"></div>
        <div id="tag-form-slot"></div>
        <div id="tag-list-slot"></div>
      </section>
      <section class="view-panel" id="view-data" role="tabpanel" data-panel="data">
        ${importHtml()}
      </section>
    </main>
  `;
  if (statusMsg) {
    const status = document.createElement('div');
    status.className = 'status';
    status.textContent = statusMsg;
    document.querySelector('#status-slot')?.replaceChildren(status);
  }
  document
    .querySelector('#tab-actions-slot')
    ?.replaceChildren(renderTabActions(setStatus, settings.summarizer.enabled));
  document
    .querySelector('#accounts-slot')
    ?.replaceChildren(
      renderAccountsSection(accounts, editingAccountId, totpDisplay, recoveryAvailable),
    );
  document.querySelector('#tag-form-slot')?.replaceChildren(renderTagForm(editTag));
  document.querySelector('#tag-list-slot')?.replaceChildren(renderTagList(tags, search));
  void renderProviderSettings(setStatus, (next) => {
    settings = next;
  }).then((section) => {
    if (generation !== renderGeneration) return;
    document.querySelector('#provider-settings-slot')?.replaceChildren(section);
  });
  syncActiveView();
  bind();
}

function syncActiveView(): void {
  app.querySelectorAll<HTMLElement>('[data-panel]').forEach((panel) => {
    panel.hidden = panel.dataset.panel !== activeView;
  });
  app.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((button) => {
    const selected = button.dataset.view === activeView;
    button.setAttribute('aria-selected', String(selected));
    button.tabIndex = selected ? 0 : -1;
  });
}

function readForm(): Omit<UserTag, 'updatedAt'> {
  const user = normalizeUsername(document.querySelector<HTMLInputElement>('#f-user')?.value || '');
  const label = document.querySelector<HTMLInputElement>('#f-label')?.value.trim() || undefined;
  const colorSelect = document.querySelector<HTMLSelectElement>('#f-color')?.value || '';
  const color = colorSelect || undefined;
  const ignore = document.querySelector<HTMLInputElement>('#f-ignore')?.checked ?? false;

  return {
    username: user,
    label: label?.slice(0, 200),
    color: color && isSafeColor(color) ? color : undefined,
    ignore: ignore || undefined,
  };
}

function stopTotpTimer(): void {
  if (totpTimer != null) {
    window.clearInterval(totpTimer);
    totpTimer = undefined;
  }
}

async function refreshTotp(accountId: string): Promise<void> {
  const result = await send<{
    ok: boolean;
    code?: string;
    remaining?: number;
    error?: string;
  }>({ type: 'linchpin:totp', accountId });

  if (!result.ok || !result.code) {
    totpDisplay = null;
    setStatus(result.error || 'TOTP unavailable');
    return;
  }
  totpDisplay = {
    accountId,
    code: result.code,
    remaining: result.remaining ?? 0,
  };
  render();
}

function startTotpPolling(accountId: string): void {
  stopTotpTimer();
  void refreshTotp(accountId);
  totpTimer = window.setInterval(() => {
    if (!totpDisplay || totpDisplay.accountId !== accountId || totpDisplay.remaining <= 1) {
      void refreshTotp(accountId);
      return;
    }
    totpDisplay = { ...totpDisplay, remaining: totpDisplay.remaining - 1 };
    const countdown = document.querySelector<HTMLElement>(
      `[data-totp-countdown="${CSS.escape(accountId)}"]`,
    );
    if (countdown) countdown.textContent = `${totpDisplay.remaining}s`;
  }, 1000);
}

function onSearchInput(event: Event): void {
  const target = event.target as HTMLInputElement;
  search = target.value;
  const pos = target.selectionStart;
  document.querySelector('#tag-list-slot')?.replaceChildren(renderTagList(tags, search));
  const input = document.querySelector<HTMLInputElement>('#search');
  input?.addEventListener('input', onSearchInput);
  if (input && pos != null) {
    input.focus();
    input.setSelectionRange(pos, pos);
  }
}

function bind(): void {
  const viewButtons = [...app.querySelectorAll<HTMLButtonElement>('[data-view]')];
  viewButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const view = button.dataset.view;
      if (view !== 'tools' && view !== 'reddit' && view !== 'data') return;
      activeView = view;
      syncActiveView();
    });
  });
  app.querySelector('.app-nav')?.addEventListener('keydown', (event) => {
    if (
      !(event instanceof KeyboardEvent) ||
      (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')
    )
      return;
    const current = viewButtons.findIndex((button) => button.dataset.view === activeView);
    const offset = event.key === 'ArrowRight' ? 1 : -1;
    const next = viewButtons[(current + offset + viewButtons.length) % viewButtons.length];
    const view = next?.dataset.view;
    if (!next || (view !== 'tools' && view !== 'reddit' && view !== 'data')) return;
    event.preventDefault();
    activeView = view;
    syncActiveView();
    next.focus();
  });
  document.querySelector('#enableTags')?.addEventListener('change', async (e) => {
    settings = await updateSettings({
      reddit: { tags: (e.target as HTMLInputElement).checked },
    });
    setStatus('Settings saved');
  });
  document.querySelector('#enableIgnore')?.addEventListener('change', async (e) => {
    settings = await updateSettings({
      reddit: { ignore: (e.target as HTMLInputElement).checked },
    });
    setStatus('Settings saved');
  });
  document.querySelector('#enableScroll')?.addEventListener('change', async (e) => {
    settings = await updateSettings({
      reddit: { infiniteScroll: (e.target as HTMLInputElement).checked },
    });
    setStatus('Settings saved');
  });
  document.querySelector('#enableSubVisits')?.addEventListener('change', async (e) => {
    settings = await updateSettings({
      reddit: { subredditVisits: (e.target as HTMLInputElement).checked },
    });
    setStatus('Settings saved');
  });
  document.querySelector('#enableNcc')?.addEventListener('change', async (e) => {
    settings = await updateSettings({
      reddit: { newCommentCounts: (e.target as HTMLInputElement).checked },
    });
    setStatus('Settings saved');
  });
  document.querySelector('#badgeStyle')?.addEventListener('change', async (e) => {
    settings = await updateSettings({
      reddit: {
        tagBadgeStyle: (e.target as HTMLSelectElement).value as Settings['reddit']['tagBadgeStyle'],
      },
    });
    setStatus('Settings saved');
  });
  const checkboxSettings: Array<
    [string, (checked: boolean) => Parameters<typeof updateSettings>[0]]
  > = [
    ['#enableAccountSwitcher', (checked) => ({ reddit: { accountSwitcher: checked } })],
    ['#enableJson', (checked) => ({ jsonFormatter: { enabled: checked } })],
    ['#jsonArrayIndices', (checked) => ({ jsonFormatter: { showArrayIndices: checked } })],
    ['#enableMaps', (checked) => ({ google: { mapsButton: checked } })],
    ['#enableViewImage', (checked) => ({ google: { viewImage: checked } })],
    ['#enableShorts', (checked) => ({ youtube: { removeShorts: checked } })],
  ];
  for (const [selector, patch] of checkboxSettings) {
    document.querySelector(selector)?.addEventListener('change', async (event) => {
      settings = await updateSettings(patch((event.target as HTMLInputElement).checked));
      setStatus('Settings saved');
    });
  }
  document.querySelector('#jsonTheme')?.addEventListener('change', async (event) => {
    const value = (event.target as HTMLSelectElement).value;
    if (value !== 'system' && value !== 'light' && value !== 'dark') return;
    settings = await updateSettings({ jsonFormatter: { darkMode: value } });
    setStatus('Settings saved');
  });
  document.querySelector('#jsonItemCountMode')?.addEventListener('change', async (event) => {
    const value = (event.target as HTMLSelectElement).value;
    if (value !== 'hide' && value !== 'show' && value !== 'threshold') return;
    settings = await updateSettings({ jsonFormatter: { itemCountMode: value } });
    setStatus('Settings saved');
  });
  document.querySelector('#jsonItemCountThreshold')?.addEventListener('change', async (event) => {
    const input = event.target as HTMLInputElement;
    const value = Math.max(1, Math.min(100_000, Math.trunc(input.valueAsNumber || 15)));
    settings = await updateSettings({ jsonFormatter: { itemCountThreshold: value } });
    setStatus('Settings saved');
  });

  document.querySelector('#search')?.addEventListener('input', onSearchInput);

  document.querySelector('#save-tag')?.addEventListener('click', async () => {
    const data = readForm();
    if (!data.username) {
      setStatus('Username required');
      return;
    }
    await upsertTag(data);
    editing = null;
    tags = await getTags();
    setStatus(`Saved u/${data.username}`);
  });

  document.querySelector('#cancel-edit')?.addEventListener('click', () => {
    editing = null;
    render();
  });

  app.querySelectorAll<HTMLButtonElement>('[data-edit]').forEach((btn) => {
    btn.addEventListener('click', () => {
      editing = btn.dataset.edit || null;
      render();
    });
  });

  app.querySelectorAll<HTMLButtonElement>('[data-del]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const user = btn.dataset.del!;
      if (!confirm(`Delete tag for u/${user}?`)) return;
      await deleteTag(user);
      if (editing === user) editing = null;
      tags = await getTags();
      setStatus(`Deleted u/${user}`);
    });
  });

  // Accounts
  document.querySelector('#restore-account-session')?.addEventListener('click', async () => {
    const result = await send<{ ok: boolean; message: string }>({
      type: 'linchpin:restore-account-session',
    });
    accounts = await getAccountStore();
    recoveryAvailable = Boolean(await getAccountRecovery());
    setStatus(result.message);
  });

  document.querySelector('#save-account')?.addEventListener('click', async () => {
    const label = document.querySelector<HTMLInputElement>('#a-label')?.value.trim() || '';
    if (!label) {
      setStatus('Account label required');
      return;
    }
    const usernameRaw = document.querySelector<HTMLInputElement>('#a-user')?.value.trim() || '';
    const totpRaw = document.querySelector<HTMLInputElement>('#a-totp')?.value.trim() || '';

    const existing = editingAccountId
      ? accounts.accounts.find((a) => a.id === editingAccountId)
      : undefined;

    const next: StoredAccount = {
      id: existing?.id ?? newAccountId(),
      label,
      username: usernameRaw ? normalizeUsername(usernameRaw) : undefined,
      cookies: existing?.cookies ?? [],
      totpSecret: totpRaw ? totpRaw.replace(/\s/g, '').toUpperCase() : existing?.totpSecret,
      sessionStatus: existing?.sessionStatus ?? 'unknown',
      savedAt: existing?.savedAt,
      lastSwitchedAt: existing?.lastSwitchedAt,
    };
    if (!next.username) delete next.username;
    if (!next.totpSecret) delete next.totpSecret;

    accounts = await upsertAccount(next);
    editingAccountId = null;
    setStatus(
      `Saved account “${label}”${next.totpSecret ? ` (TOTP ${maskSecret(next.totpSecret)})` : ''}`,
    );
  });

  document.querySelector('#cancel-account')?.addEventListener('click', () => {
    editingAccountId = null;
    render();
  });

  document.querySelector('#clear-totp')?.addEventListener('click', async () => {
    if (!editingAccountId) return;
    const existing = accounts.accounts.find((a) => a.id === editingAccountId);
    if (!existing) return;
    if (!confirm('Remove stored TOTP secret for this account?')) return;
    const next = { ...existing };
    delete next.totpSecret;
    accounts = await upsertAccount(next);
    setStatus('TOTP secret cleared');
  });

  app.querySelectorAll<HTMLButtonElement>('[data-edit-acct]').forEach((btn) => {
    btn.addEventListener('click', () => {
      editingAccountId = btn.dataset.editAcct || null;
      render();
    });
  });

  app.querySelectorAll<HTMLButtonElement>('[data-del-acct]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.delAcct!;
      const acc = accounts.accounts.find((a) => a.id === id);
      if (!confirm(`Remove account “${acc?.label ?? id}” and its saved session?`)) {
        return;
      }
      if (totpDisplay?.accountId === id) {
        stopTotpTimer();
        totpDisplay = null;
      }
      accounts = await removeAccount(id);
      if (editingAccountId === id) editingAccountId = null;
      setStatus('Account removed');
    });
  });

  app.querySelectorAll<HTMLButtonElement>('[data-capture]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.capture!;
      const result = await send<{
        ok: boolean;
        cookieCount: number;
        sessionLooksValid: boolean;
        message: string;
      }>({ type: 'linchpin:capture-session', accountId: id });
      accounts = await getAccountStore();
      setStatus(result.message);
    });
  });

  app.querySelectorAll<HTMLButtonElement>('[data-switch]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.switch!;
      const result = await send<{
        ok: boolean;
        needsRelogin: boolean;
        message: string;
      }>({ type: 'linchpin:switch-account', accountId: id });
      accounts = await getAccountStore();
      if (result.needsRelogin) {
        const acc = accounts.accounts.find((a) => a.id === id);
        if (acc?.totpSecret) startTotpPolling(id);
      }
      setStatus(result.message);
    });
  });

  app.querySelectorAll<HTMLButtonElement>('[data-totp]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.totp!;
      startTotpPolling(id);
    });
  });

  app.querySelectorAll<HTMLButtonElement>('[data-copy-totp]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!totpDisplay) return;
      try {
        await navigator.clipboard.writeText(totpDisplay.code);
        setStatus('TOTP code copied');
      } catch {
        setStatus(`TOTP: ${totpDisplay.code}`);
      }
    });
  });

  document.querySelector('#import-btn')?.addEventListener('click', async () => {
    const text = document.querySelector<HTMLTextAreaElement>('#import-json')?.value || '';
    try {
      const parsed = parseLinchpinBackupText(text);
      const parts: string[] = [];

      if (parsed.settings) {
        settings = await replaceSettings(parsed.settings);
        parts.push('settings');
      }
      if (parsed.tags) {
        const result = await mergeTags(parsed.tags);
        tags = await getTags();
        parts.push(`tags (${result.added} added, ${result.updated} merged)`);
      }
      if (parsed.subredditVisits) {
        const result = await mergeSubredditVisits(parsed.subredditVisits);
        parts.push(`sub visits (${result.added}+${result.updated})`);
      }
      if (parsed.threadVisits) {
        const result = await mergeThreadVisits(parsed.threadVisits);
        parts.push(`thread visits (${result.added}+${result.updated})`);
      }

      let msg = `Imported: ${parts.join('; ')}`;
      if (parsed.ignoredAccounts) {
        msg += ' (accounts/secrets in file were ignored)';
      }
      setStatus(msg);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Import failed');
    }
  });

  document.querySelector('#import-seed')?.addEventListener('click', async () => {
    try {
      const url = browser.runtime.getURL('/data/res-tags-seed.json');
      const res = await fetch(url);
      if (!res.ok) throw new Error('Seed file not found in extension package');
      const json = await res.json();
      const parsed = parseResTagsText(JSON.stringify(json));
      const result = await mergeTags(parsed);
      tags = await getTags();
      setStatus(
        `Seed loaded: ${result.added} added, ${result.updated} merged (${Object.keys(tags).length} total)`,
      );
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Seed import failed');
    }
  });

  document.querySelector('#export-btn')?.addEventListener('click', async () => {
    const payload = buildLinchpinBackup({
      tags: await getTags(),
      settings: await getSettings(),
      subredditVisits: await getSubredditVisits(),
      threadVisits: await getThreadVisits(),
    });
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `linchpin-backup-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    setStatus('Linchpin backup downloaded (no account secrets)');
  });

  document.querySelector('#export-tags-btn')?.addEventListener('click', () => {
    const payload = buildSafeExport(tags);
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `linchpin-tags-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    setStatus('Tag export downloaded (no account secrets)');
  });
}

window.addEventListener(
  'pagehide',
  () => {
    stopTotpTimer();
    if (statusTimer != null) window.clearTimeout(statusTimer);
  },
  { once: true },
);
void reload();
