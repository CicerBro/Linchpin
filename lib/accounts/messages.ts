export type LinchpinMessage =
  | { type: 'linchpin:switch-account'; accountId: string }
  | {
      type: 'linchpin:reddit-login';
      username: string;
      password: string;
      otp?: string;
    }
  | { type: 'linchpin:totp'; accountId: string }
  | { type: 'linchpin:ping' }
  | { type: 'linchpin:set-action-icon-theme'; theme: 'light' | 'dark' };
