import { accountPublicSummary } from '../../lib/storage';
import type { AccountStore, StoredAccount, UserTag, UserTagMap } from '../../lib/types';
import { formatNetVote, netVoteScore } from '../../lib/reddit/votes';

const TAG_COLORS = [
  { name: 'Ocean blue', value: '#3578e5' },
  { name: 'Leaf green', value: '#2e9d62' },
  { name: 'Sunflower', value: '#d99a00' },
  { name: 'Coral red', value: '#d95757' },
  { name: 'Royal purple', value: '#805ad5' },
  { name: 'Graphite', value: '#56616b' },
] as const;

function node<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: { className?: string; text?: string } = {},
): HTMLElementTagNameMap[K] {
  const result = document.createElement(tag);
  if (options.className) result.className = options.className;
  if (options.text != null) result.textContent = options.text;
  return result;
}

function button(text: string, data?: [string, string], className?: string): HTMLButtonElement {
  const result = node('button', { text, className });
  result.type = 'button';
  if (data) result.dataset[data[0]] = data[1];
  return result;
}

function field(labelText: string, input: HTMLElement): HTMLLabelElement {
  const label = node('label', { className: 'field' });
  label.append(node('span', { text: labelText }), input);
  return label;
}

function accountForm(account?: StoredAccount): HTMLElement {
  const form = node('div', { className: 'account-form' });
  form.id = 'account-form';
  form.append(node('h3', { text: account ? 'Edit account' : 'Add account' }));
  const label = node('input');
  label.id = 'a-label';
  label.type = 'text';
  label.placeholder = 'Optional — defaults to username';
  label.maxLength = 200;
  label.value = account?.label ?? '';
  const username = node('input');
  username.id = 'a-user';
  username.type = 'text';
  username.placeholder = 'username';
  username.maxLength = 64;
  username.value = account?.username ?? '';
  const password = node('input');
  password.id = 'a-password';
  password.type = 'password';
  password.autocomplete = 'off';
  password.maxLength = 256;
  password.placeholder = account?.password ? '•••• saved — type to replace' : 'Reddit password';
  const totp = node('input');
  totp.id = 'a-totp';
  totp.type = 'password';
  totp.autocomplete = 'off';
  totp.maxLength = 256;
  totp.placeholder = account?.totpSecret ? '•••• saved — paste to replace' : 'JBSW Y3DP EHPK 3PXP';
  const warning = node('p', {
    className: 'help warn',
    text: 'Secrets stay on-device in extension local storage, which is not strongly encrypted. They are never exported.',
  });
  const actions = node('div', { className: 'actions' });
  const save = button(account ? 'Save' : 'Add', undefined, 'primary');
  save.id = 'save-account';
  actions.append(save);
  if (account) {
    const cancel = button('Cancel');
    cancel.id = 'cancel-account';
    actions.append(cancel);
    if (account.totpSecret) {
      const clear = button('Clear TOTP');
      clear.id = 'clear-totp';
      actions.append(clear);
    }
    if (account.password) {
      const clear = button('Clear password');
      clear.id = 'clear-password';
      actions.append(clear);
    }
  }
  form.append(
    field('Label (optional)', label),
    field('Reddit username', username),
    field('Reddit password', password),
    field('TOTP secret (Base32, optional)', totp),
    warning,
    actions,
  );
  return form;
}

export function renderAccountsSection(
  store: AccountStore,
  editingAccountId: string | null,
  totpDisplay: { accountId: string; code: string; remaining: number } | null,
): HTMLElement {
  const section = node('section', { className: 'panel' });
  section.append(
    node('p', { className: 'eyebrow', text: 'Logins' }),
    node('h2', { text: 'Accounts' }),
    node('p', {
      className: 'help',
      text: 'Linchpin uses Reddit’s normal logout/login flow, like RES. A saved TOTP secret is used automatically.',
    }),
  );
  const list = node('ul', { className: 'account-list' });
  if (!store.accounts.length)
    list.append(
      node('li', {
        className: 'empty',
        text: 'No accounts yet — add a Reddit username and password.',
      }),
    );
  for (const account of store.accounts) {
    const summary = accountPublicSummary(account);
    const active = store.activeAccountId === account.id;
    const item = node('li', { className: active ? 'active-account' : '' });
    const main = node('div', { className: 'account-main' });
    main.append(node('strong', { text: account.label }));
    if (account.username)
      main.append(node('span', { className: 'muted', text: `u/${account.username}` }));
    const sessionClass =
      !summary.hasPassword || summary.sessionStatus === 'expired'
        ? 'status-expired'
        : summary.sessionStatus === 'active'
          ? 'status-active'
          : '';
    const loginStatus = !summary.hasPassword
      ? 'needs password'
      : summary.sessionStatus === 'active'
        ? 'active'
        : summary.sessionStatus === 'expired'
          ? 'login failed'
          : 'ready';
    main.append(node('span', { className: `pill ${sessionClass}`, text: loginStatus }));
    if (active) main.append(node('span', { className: 'pill status-active', text: 'active' }));
    main.append(
      node('span', {
        className: 'muted',
        text: `${summary.hasPassword ? 'password saved' : 'no password'}${summary.hasTotp ? ' · automatic TOTP' : ''}`,
      }),
    );
    item.append(main);
    if (totpDisplay?.accountId === account.id) {
      const row = node('div', { className: 'totp-row' });
      const countdown = node('span', { className: 'muted', text: `${totpDisplay.remaining}s` });
      countdown.dataset.totpCountdown = account.id;
      row.append(
        node('code', { className: 'totp-code', text: totpDisplay.code }),
        countdown,
        button('Copy', ['copyTotp', account.id]),
      );
      item.append(row);
    }
    const actions = node('div', { className: 'tag-actions account-actions' });
    actions.append(button('Switch', ['switch', account.id], 'primary'));
    if (summary.hasTotp) actions.append(button('TOTP', ['totp', account.id]));
    actions.append(
      button('Edit', ['editAcct', account.id]),
      button('Remove', ['delAcct', account.id], 'danger'),
    );
    item.append(actions);
    list.append(item);
  }
  section.append(list);
  section.append(
    accountForm(
      editingAccountId
        ? store.accounts.find((account) => account.id === editingAccountId)
        : undefined,
    ),
  );
  return section;
}

export function renderTagForm(tag?: UserTag): HTMLElement {
  const section = node('section', { className: 'panel' });
  section.id = 'tag-form';
  section.append(
    node('p', { className: 'eyebrow', text: 'User labels' }),
    node('h2', { text: tag ? 'Edit tag' : 'Add tag' }),
  );
  const username = node('input');
  username.id = 'f-user';
  username.type = 'text';
  username.placeholder = 'username';
  username.maxLength = 64;
  username.value = tag?.username ?? '';
  username.readOnly = Boolean(tag);
  const label = node('input');
  label.id = 'f-label';
  label.type = 'text';
  label.placeholder = 'e.g. bot, friend';
  label.maxLength = 200;
  label.value = tag?.label ?? '';
  const color = node('select');
  color.id = 'f-color';
  const isPresetColor = TAG_COLORS.some(({ value }) => value === tag?.color?.toLowerCase());
  if (tag?.color && !isPresetColor) {
    const legacy = node('option', { text: 'Current custom color (legacy)' });
    legacy.value = tag.color;
    legacy.selected = true;
    color.append(legacy);
  }
  for (const { name, value } of TAG_COLORS) {
    const option = node('option', { text: name });
    option.value = value;
    option.selected = tag?.color?.toLowerCase() === value;
    color.append(option);
  }
  const ignore = node('input');
  ignore.id = 'f-ignore';
  ignore.type = 'checkbox';
  ignore.checked = Boolean(tag?.ignore);
  const ignoreLabel = node('label', { className: 'row' });
  ignoreLabel.append(ignore, document.createTextNode(' Ignore / hide'));
  const actions = node('div', { className: 'actions' });
  const save = button(tag ? 'Save' : 'Add', undefined, 'primary');
  save.id = 'save-tag';
  actions.append(save);
  if (tag) {
    const cancel = button('Cancel');
    cancel.id = 'cancel-edit';
    actions.append(cancel);
  }
  section.append(
    field('Username', username),
    field('Color', color),
    field('Label', label),
    ignoreLabel,
    actions,
  );
  return section;
}

export function renderTagList(tags: UserTagMap, search: string): HTMLElement {
  const q = search.trim().toLowerCase();
  const filtered = Object.values(tags)
    .filter((tag) => !q || tag.username.includes(q) || (tag.label ?? '').toLowerCase().includes(q))
    .sort((a, b) => a.username.localeCompare(b.username));
  const section = node('section', { className: 'panel' });
  const header = node('div', { className: 'list-header' });
  const heading = node('h2', { text: `Tags (${filtered.length})` });
  const input = node('input');
  input.id = 'search';
  input.type = 'search';
  input.placeholder = 'Search…';
  input.value = search;
  header.append(heading, input);
  section.append(header);
  const list = node('ul', { className: 'tag-list' });
  if (!filtered.length) list.append(node('li', { className: 'empty', text: 'No tags yet.' }));
  for (const tag of filtered) {
    const item = node('li');
    const main = node('div', { className: 'tag-main' });
    if (
      tag.color &&
      tag.color.length <= 80 &&
      !/[<>"'`;{}]/.test(tag.color) &&
      CSS.supports('color', tag.color)
    ) {
      const swatch = node('span', { className: 'swatch' });
      swatch.style.backgroundColor = tag.color;
      main.append(swatch);
    }
    main.append(node('strong', { text: `u/${tag.username}` }));
    const score = netVoteScore(tag);
    const details = [
      tag.label ?? '',
      tag.ignore ? 'ignore' : '',
      !tag.label && score != null ? formatNetVote(score) : '',
    ]
      .filter(Boolean)
      .join(' · ');
    main.append(node('span', { className: 'muted', text: details }));
    const actions = node('div', { className: 'tag-actions' });
    actions.append(
      button('Edit', ['edit', tag.username]),
      button('Delete', ['del', tag.username], 'danger'),
    );
    item.append(main, actions);
    list.append(item);
  }
  section.append(list);
  return section;
}
