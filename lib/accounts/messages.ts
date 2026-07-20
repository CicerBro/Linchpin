export type LinchpinMessage =
  | { type: 'linchpin:capture-session'; accountId: string }
  | { type: 'linchpin:switch-account'; accountId: string }
  | { type: 'linchpin:restore-account-session' }
  | { type: 'linchpin:totp'; accountId: string }
  | { type: 'linchpin:ping' }
  | { type: 'linchpin:set-action-icon-theme'; theme: 'light' | 'dark' };
