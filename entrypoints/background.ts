import {
  captureSessionForAccount,
  switchToAccount,
} from '../lib/accounts/switcher';
import { generateTotp } from '../lib/accounts/totp';
import type { RivetMessage } from '../lib/accounts/messages';
import { getAccountStore } from '../lib/storage';

export default defineBackground(() => {
  console.info('[rivet] background ready', { id: browser.runtime.id });

  browser.runtime.onMessage.addListener((message: RivetMessage) => {
    if (!message || typeof message !== 'object' || !('type' in message)) {
      return undefined;
    }

    if (message.type === 'rivet:ping') {
      return Promise.resolve({ ok: true });
    }

    if (message.type === 'rivet:capture-session') {
      return captureSessionForAccount(message.accountId);
    }

    if (message.type === 'rivet:switch-account') {
      return switchToAccount(message.accountId);
    }

    if (message.type === 'rivet:totp') {
      return (async () => {
        const store = await getAccountStore();
        const account = store.accounts.find((a) => a.id === message.accountId);
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
