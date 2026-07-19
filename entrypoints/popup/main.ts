import './style.css';
import {
  accountPublicSummary,
  buildSafeExport,
  deleteTag,
  getAccountStore,
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
import type {
  AccountStore,
  Settings,
  StoredAccount,
  UserTag,
  UserTagMap,
} from '../../lib/types';
import { parseResTagsText } from '../../lib/import/resTags';
import {
  buildRivetBackup,
  parseRivetBackupText,
} from '../../lib/import/rivetBackup';
import { ensureResSeedImported } from '../../lib/import/ensureSeed';
import { formatNetVote, netVoteScore } from '../../lib/reddit/votes';
import { maskSecret } from '../../lib/accounts/totp';
import type { RivetMessage } from '../../lib/accounts/messages';

const app = document.querySelector<HTMLDivElement>('#app')!;

let tags: UserTagMap = {};
let settings: Settings;
let accounts: AccountStore = { accounts: [], activeAccountId: null };
let search = '';
let editing: string | null = null;
let editingAccountId: string | null = null;
let statusMsg = '';
let totpDisplay: { accountId: string; code: string; remaining: number } | null =
  null;
let totpTimer: number | undefined;

const COLORS = [
  '',
  'cornflowerblue',
  '#e53935',
  '#43a047',
  '#fb8c00',
  '#8e24aa',
  '#546e7a',
  '#000000',
];

function setStatus(msg: string): void {
  statusMsg = msg;
  render();
  if (msg) {
    window.setTimeout(() => {
      if (statusMsg === msg) {
        statusMsg = '';
        render();
      }
    }, 3500);
  }
}

async function send<T>(msg: RivetMessage): Promise<T> {
  return browser.runtime.sendMessage(msg) as Promise<T>;
}

function filteredTags(): UserTag[] {
  const q = search.trim().toLowerCase();
  return Object.values(tags)
    .filter((t) => {
      if (!q) return true;
      return (
        t.username.includes(q) ||
        (t.label ?? '').toLowerCase().includes(q)
      );
    })
    .sort((a, b) => a.username.localeCompare(b.username));
}

async function reload(): Promise<void> {
  const seed = await ensureResSeedImported();
  tags = await getTags();
  settings = await getSettings();
  accounts = await getAccountStore();
  if (seed.status === 'imported') {
    statusMsg = `Imported ${seed.added} RES tags from Brave seed`;
  }
  render();
}

function settingsHtml(): string {
  return `
    <section class="panel">
      <h2>Settings</h2>
      <label class="row">
        <input type="checkbox" id="enableTags" ${settings.enableTags ? 'checked' : ''} />
        Show tags
      </label>
      <label class="row">
        <input type="checkbox" id="enableIgnore" ${settings.enableIgnore ? 'checked' : ''} />
        Hide ignored users
      </label>
      <label class="row">
        <input type="checkbox" id="enableScroll" ${settings.enableOldRedditInfiniteScroll ? 'checked' : ''} />
        Infinite scroll (old Reddit)
      </label>
      <label class="row">
        <input type="checkbox" id="enableSubVisits" ${settings.enableSubredditLastVisited ? 'checked' : ''} />
        Subreddit last-visited hints
      </label>
      <label class="row">
        <input type="checkbox" id="enableNcc" ${settings.enableNewCommentCounts ? 'checked' : ''} />
        New comment counts on threads
      </label>
      <label class="row">
        Badge style
        <select id="badgeStyle">
          <option value="pill" ${settings.tagBadgeStyle === 'pill' ? 'selected' : ''}>Pill</option>
          <option value="text" ${settings.tagBadgeStyle === 'text' ? 'selected' : ''}>Text</option>
        </select>
      </label>
    </section>
  `;
}

function accountFormHtml(account?: StoredAccount): string {
  const isEdit = Boolean(account);
  return `
    <div class="account-form" id="account-form">
      <h3>${isEdit ? 'Edit account' : 'Add account'}</h3>
      <label class="field">
        Label
        <input id="a-label" type="text" placeholder="e.g. Main, Work alt" value="${escapeHtml(account?.label ?? '')}" />
      </label>
      <label class="field">
        Reddit username (optional)
        <input id="a-user" type="text" placeholder="username" value="${escapeHtml(account?.username ?? '')}" />
      </label>
      <label class="field">
        TOTP secret (Base32, optional)
        <input id="a-totp" type="password" autocomplete="off" placeholder="${
          account?.totpSecret ? '•••• saved — paste to replace' : 'JBSW Y3DP EHPK 3PXP'
        }" />
      </label>
      <p class="help warn">Secrets stay on-device in chrome.storage.local. Never share exports. Personal use only.</p>
      <div class="actions">
        <button type="button" id="save-account" class="primary">${isEdit ? 'Save' : 'Add'}</button>
        ${isEdit ? '<button type="button" id="cancel-account">Cancel</button>' : ''}
        ${
          isEdit && account?.totpSecret
            ? '<button type="button" id="clear-totp">Clear TOTP</button>'
            : ''
        }
      </div>
    </div>
  `;
}

function accountsHtml(): string {
  const list = accounts.accounts;
  const editAcc = editingAccountId
    ? list.find((a) => a.id === editingAccountId)
    : undefined;

  return `
    <section class="panel">
      <h2>Accounts</h2>
      <p class="help">Also available on Reddit as a <strong>Rivet</strong> control next to the user menu (top right). Manage accounts here; switch there for speed.</p>
      <ul class="account-list">
        ${
          list.length
            ? list
                .map((a) => {
                  const pub = accountPublicSummary(a);
                  const active = accounts.activeAccountId === a.id;
                  const statusClass =
                    pub.sessionStatus === 'expired'
                      ? 'status-expired'
                      : pub.sessionStatus === 'active'
                        ? 'status-active'
                        : '';
                  const totpBlock =
                    totpDisplay?.accountId === a.id
                      ? `<div class="totp-row">
                          <code class="totp-code">${escapeHtml(totpDisplay.code)}</code>
                          <span class="muted">${totpDisplay.remaining}s</span>
                          <button type="button" data-copy-totp="${escapeHtml(a.id)}">Copy</button>
                        </div>`
                      : '';
                  return `
                  <li class="${active ? 'active-account' : ''}">
                    <div class="account-main">
                      <strong>${escapeHtml(a.label)}</strong>
                      ${a.username ? `<span class="muted">u/${escapeHtml(a.username)}</span>` : ''}
                      <span class="pill ${statusClass}">${escapeHtml(pub.sessionStatus)}</span>
                      ${active ? '<span class="pill status-active">active</span>' : ''}
                      <span class="muted">${pub.hasCookies ? `${a.cookies.length} cookies` : 'no session'}${
                        pub.hasTotp ? ' · TOTP' : ''
                      }</span>
                    </div>
                    ${totpBlock}
                    <div class="tag-actions account-actions">
                      <button type="button" class="primary" data-switch="${escapeHtml(a.id)}">Switch</button>
                      <button type="button" data-capture="${escapeHtml(a.id)}">Capture session</button>
                      ${
                        pub.hasTotp
                          ? `<button type="button" data-totp="${escapeHtml(a.id)}">TOTP</button>`
                          : ''
                      }
                      <button type="button" data-edit-acct="${escapeHtml(a.id)}">Edit</button>
                      <button type="button" data-del-acct="${escapeHtml(a.id)}" class="danger">Remove</button>
                    </div>
                  </li>`;
                })
                .join('')
            : '<li class="empty">No accounts yet — add one, log into Reddit, then Capture session.</li>'
        }
      </ul>
      ${accountFormHtml(editAcc)}
    </section>
  `;
}

function formHtml(tag?: UserTag): string {
  const isEdit = Boolean(tag);
  return `
    <section class="panel" id="tag-form">
      <h2>${isEdit ? 'Edit tag' : 'Add tag'}</h2>
      <label class="field">
        Username
        <input id="f-user" type="text" placeholder="username" value="${tag?.username ?? ''}" ${isEdit ? 'readonly' : ''} />
      </label>
      <label class="field">
        Label
        <input id="f-label" type="text" placeholder="e.g. bot, friend" value="${tag?.label ?? ''}" />
      </label>
      <label class="field">
        Color
        <select id="f-color">
          ${COLORS.map(
            (c) =>
              `<option value="${c}" ${tag?.color === c ? 'selected' : ''}>${c || '(default)'}</option>`,
          ).join('')}
        </select>
      </label>
      <label class="field">
        Custom color
        <input id="f-color-custom" type="text" placeholder="#rrggbb or name" value="${
          tag?.color && !COLORS.includes(tag.color) ? tag.color : ''
        }" />
      </label>
      <label class="row">
        <input id="f-ignore" type="checkbox" ${tag?.ignore ? 'checked' : ''} />
        Ignore / hide
      </label>
      <div class="actions">
        <button type="button" id="save-tag" class="primary">${isEdit ? 'Save' : 'Add'}</button>
        ${isEdit ? '<button type="button" id="cancel-edit">Cancel</button>' : ''}
      </div>
    </section>
  `;
}

function listHtml(): string {
  const list = filteredTags();
  return `
    <section class="panel">
      <div class="list-header">
        <h2>Tags <span class="muted">(${list.length})</span></h2>
        <input id="search" type="search" placeholder="Search…" value="${search.replace(/"/g, '&quot;')}" />
      </div>
      <ul class="tag-list">
        ${
          list.length
            ? list
                .map((t) => {
                  const swatch = t.color
                    ? `<span class="swatch" style="background:${t.color}"></span>`
                    : '';
                  const score = netVoteScore(t);
                  const bits = [
                    t.label ? escapeHtml(t.label) : '',
                    t.ignore ? 'ignore' : '',
                    !t.label && score != null ? escapeHtml(formatNetVote(score)) : '',
                  ]
                    .filter(Boolean)
                    .join(' · ');
                  return `
                  <li>
                    <div class="tag-main">
                      ${swatch}
                      <strong>u/${escapeHtml(t.username)}</strong>
                      <span class="muted">${bits}</span>
                    </div>
                    <div class="tag-actions">
                      <button type="button" data-edit="${escapeHtml(t.username)}">Edit</button>
                      <button type="button" data-del="${escapeHtml(t.username)}" class="danger">Delete</button>
                    </div>
                  </li>`;
                })
                .join('')
            : '<li class="empty">No tags yet.</li>'
        }
      </ul>
    </section>
  `;
}

function importHtml(): string {
  return `
    <section class="panel">
      <h2>Import / export</h2>
      <p class="help">Paste Rivet backup JSON (settings + tags + visit maps) or a RES tag export. Merges tags/visits; replaces settings when present. <strong>Never includes account cookies or TOTP secrets.</strong></p>
      <textarea id="import-json" rows="4" placeholder='{"settings":{…},"tags":{"username":{"text":"bot"}}}'></textarea>
      <div class="actions">
        <button type="button" id="import-btn" class="primary">Import</button>
        <button type="button" id="import-seed">Load seed tags</button>
        <button type="button" id="export-btn">Export Rivet JSON</button>
        <button type="button" id="export-tags-btn">Export tags only</button>
      </div>
    </section>
  `;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function render(): void {
  const editTag = editing ? tags[editing] : undefined;
  app.innerHTML = `
    <header>
      <h1>Rivet</h1>
      <p class="subtitle">Reddit tags, accounts &amp; QoL</p>
    </header>
    ${statusMsg ? `<div class="status">${escapeHtml(statusMsg)}</div>` : ''}
    ${accountsHtml()}
    ${settingsHtml()}
    ${formHtml(editTag)}
    ${listHtml()}
    ${importHtml()}
  `;
  bind();
}

function readForm(): Omit<UserTag, 'updatedAt'> {
  const user = normalizeUsername(
    document.querySelector<HTMLInputElement>('#f-user')?.value || '',
  );
  const label =
    document.querySelector<HTMLInputElement>('#f-label')?.value.trim() ||
    undefined;
  const colorSelect =
    document.querySelector<HTMLSelectElement>('#f-color')?.value || '';
  const colorCustom =
    document.querySelector<HTMLInputElement>('#f-color-custom')?.value.trim() ||
    '';
  const color = colorCustom || colorSelect || undefined;
  const ignore =
    document.querySelector<HTMLInputElement>('#f-ignore')?.checked ?? false;

  return { username: user, label, color, ignore: ignore || undefined };
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
  }>({ type: 'rivet:totp', accountId });

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
    void refreshTotp(accountId);
  }, 1000);
}

function bind(): void {
  document.querySelector('#enableTags')?.addEventListener('change', async (e) => {
    settings = await updateSettings({
      enableTags: (e.target as HTMLInputElement).checked,
    });
    setStatus('Settings saved');
  });
  document.querySelector('#enableIgnore')?.addEventListener('change', async (e) => {
    settings = await updateSettings({
      enableIgnore: (e.target as HTMLInputElement).checked,
    });
    setStatus('Settings saved');
  });
  document.querySelector('#enableScroll')?.addEventListener('change', async (e) => {
    settings = await updateSettings({
      enableOldRedditInfiniteScroll: (e.target as HTMLInputElement).checked,
    });
    setStatus('Settings saved');
  });
  document.querySelector('#enableSubVisits')?.addEventListener('change', async (e) => {
    settings = await updateSettings({
      enableSubredditLastVisited: (e.target as HTMLInputElement).checked,
    });
    setStatus('Settings saved');
  });
  document.querySelector('#enableNcc')?.addEventListener('change', async (e) => {
    settings = await updateSettings({
      enableNewCommentCounts: (e.target as HTMLInputElement).checked,
    });
    setStatus('Settings saved');
  });
  document.querySelector('#badgeStyle')?.addEventListener('change', async (e) => {
    settings = await updateSettings({
      tagBadgeStyle: (e.target as HTMLSelectElement)
        .value as Settings['tagBadgeStyle'],
    });
    setStatus('Settings saved');
  });

  document.querySelector('#search')?.addEventListener('input', (e) => {
    search = (e.target as HTMLInputElement).value;
    const pos = (e.target as HTMLInputElement).selectionStart;
    render();
    const input = document.querySelector<HTMLInputElement>('#search');
    if (input && pos != null) {
      input.focus();
      input.setSelectionRange(pos, pos);
    }
  });

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
  document.querySelector('#save-account')?.addEventListener('click', async () => {
    const label =
      document.querySelector<HTMLInputElement>('#a-label')?.value.trim() || '';
    if (!label) {
      setStatus('Account label required');
      return;
    }
    const usernameRaw =
      document.querySelector<HTMLInputElement>('#a-user')?.value.trim() || '';
    const totpRaw =
      document.querySelector<HTMLInputElement>('#a-totp')?.value.trim() || '';

    const existing = editingAccountId
      ? accounts.accounts.find((a) => a.id === editingAccountId)
      : undefined;

    const next: StoredAccount = {
      id: existing?.id ?? newAccountId(),
      label,
      username: usernameRaw ? normalizeUsername(usernameRaw) : undefined,
      cookies: existing?.cookies ?? [],
      totpSecret: totpRaw
        ? totpRaw.replace(/\s/g, '').toUpperCase()
        : existing?.totpSecret,
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
      }>({ type: 'rivet:capture-session', accountId: id });
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
      }>({ type: 'rivet:switch-account', accountId: id });
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
    const text =
      document.querySelector<HTMLTextAreaElement>('#import-json')?.value || '';
    try {
      const parsed = parseRivetBackupText(text);
      const parts: string[] = [];

      if (parsed.settings) {
        settings = await replaceSettings(parsed.settings);
        parts.push('settings');
      }
      if (parsed.tags) {
        const result = await mergeTags(parsed.tags);
        tags = await getTags();
        parts.push(
          `tags (${result.added} added, ${result.updated} merged)`,
        );
      }
      if (parsed.subredditVisits) {
        const result = await mergeSubredditVisits(parsed.subredditVisits);
        parts.push(
          `sub visits (${result.added}+${result.updated})`,
        );
      }
      if (parsed.threadVisits) {
        const result = await mergeThreadVisits(parsed.threadVisits);
        parts.push(
          `thread visits (${result.added}+${result.updated})`,
        );
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
    const payload = buildRivetBackup({
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
    a.download = `rivet-backup-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    setStatus('Rivet backup downloaded (no account secrets)');
  });

  document.querySelector('#export-tags-btn')?.addEventListener('click', () => {
    const payload = buildSafeExport(tags);
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `rivet-tags-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    setStatus('Tag export downloaded (no account secrets)');
  });
}

void reload();
