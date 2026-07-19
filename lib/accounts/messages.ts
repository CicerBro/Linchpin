export type RivetMessage =
  | { type: 'rivet:capture-session'; accountId: string }
  | { type: 'rivet:switch-account'; accountId: string }
  | { type: 'rivet:totp'; accountId: string }
  | { type: 'rivet:ping' };
