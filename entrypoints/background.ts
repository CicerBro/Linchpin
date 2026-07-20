import {
  captureSessionForAccount,
  restorePreviousAccountSession,
  switchToAccount,
} from '../lib/accounts/switcher';
import { generateTotp } from '../lib/accounts/totp';
import type { LinchpinMessage } from '../lib/accounts/messages';
import { getAccountStore, initializeStorage } from '../lib/storage';
import { ensureResSeedImported } from '../lib/import/ensureSeed';
import { isStorageMutationMessage } from '../lib/core/messages';
import { executeStorageMutation } from '../lib/storage/repositories';

export default defineBackground(() => {
  console.info('[linchpin] background ready', { id: browser.runtime.id });

  const actionIcons = {
    light: {
      16: 'icon/16.png',
      32: 'icon/32.png',
      48: 'icon/48.png',
    },
    dark: {
      16: 'icon/dark-theme-16.png',
      32: 'icon/dark-theme-32.png',
      48: 'icon/dark-theme-48.png',
    },
  } as const;

  let operationTail: Promise<unknown> = Promise.resolve();
  const serialize = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = operationTail.then(operation, operation);
    operationTail = result.then(() => undefined, () => undefined);
    return result;
  };

  const runStartup = () => {
    void initializeStorage()
      .then(() => ensureResSeedImported())
      .then((result) => {
        if (result.status === 'imported') {
          console.info('[linchpin] brought over RES tags', result);
        } else if (result.status === 'error') {
          console.warn('[linchpin] RES seed import failed', result.error);
        }
      })
      .catch((error) => console.warn('[linchpin] storage startup failed', error));
  };

  runStartup();
  browser.runtime.onInstalled.addListener(runStartup);
  browser.runtime.onStartup.addListener(runStartup);

  browser.runtime.onMessage.addListener((message: LinchpinMessage | unknown) => {
    if (!message || typeof message !== 'object' || !('type' in message)) {
      return undefined;
    }

    if (isStorageMutationMessage(message)) {
      return serialize(() => executeStorageMutation(message));
    }
    const linchpinMessage = message as LinchpinMessage;

    if (linchpinMessage.type === 'linchpin:ping') {
      return Promise.resolve({ ok: true });
    }

    if (linchpinMessage.type === 'linchpin:set-action-icon-theme') {
      return browser.action
        .setIcon({ path: actionIcons[linchpinMessage.theme] })
        .then(() => ({ ok: true as const }));
    }

    if (linchpinMessage.type === 'linchpin:capture-session') {
      return serialize(() => captureSessionForAccount(linchpinMessage.accountId));
    }

    if (linchpinMessage.type === 'linchpin:switch-account') {
      return serialize(() => switchToAccount(linchpinMessage.accountId));
    }

    if (linchpinMessage.type === 'linchpin:restore-account-session') {
      return serialize(() => restorePreviousAccountSession());
    }

    if (linchpinMessage.type === 'linchpin:totp') {
      return (async () => {
        const store = await getAccountStore();
        const account = store.accounts.find((a) => a.id === linchpinMessage.accountId);
        if (!account?.totpSecret) {
          return {
            ok: false as const,
            error: 'No TOTP secret stored for this account',
          };
        }
        try {
          const result = await generateTotp(account.totpSecret);
          return { ok: true as const, ...result };
        } catch (err) {
          return {
            ok: false as const,
            error: err instanceof Error ? err.message : 'TOTP failed',
          };
        }
      })();
    }

    return undefined;
  });
});
