export type UserTag = {
  username: string; // lowercase for matching
  label?: string; // e.g. "bot", "ignore"
  color?: string; // CSS color
  ignore?: boolean; // hide posts/comments
  link?: string; // optional RES link
  votesUp?: number;
  votesDown?: number;
  updatedAt: number;
};

export type UserTagMap = Record<string, UserTag>;

export type TagBadgeStyle = 'pill' | 'text';

export type Settings = {
  enableTags: boolean;
  enableIgnore: boolean;
  enableOldRedditInfiniteScroll: boolean;
  enableSubredditLastVisited: boolean;
  enableNewCommentCounts: boolean;
  tagBadgeStyle: TagBadgeStyle;
};

export const DEFAULT_SETTINGS: Settings = {
  enableTags: true,
  enableIgnore: true,
  enableOldRedditInfiniteScroll: true,
  enableSubredditLastVisited: true,
  enableNewCommentCounts: true,
  tagBadgeStyle: 'pill',
};

export type RedditUiVersion = 'old' | 'new' | 'unknown';

/** Cookie snapshot fields we persist for Reddit session swap. */
export type StoredCookie = {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: 'no_restriction' | 'lax' | 'strict' | 'unspecified';
  expirationDate?: number;
  storeId?: string;
};

export type AccountSessionStatus = 'unknown' | 'saved' | 'active' | 'expired';

/**
 * Stored Reddit account for the switcher.
 * Cookies + TOTP secrets are sensitive — local storage only; never export.
 */
export type StoredAccount = {
  id: string;
  label: string;
  /** Reddit username if known (display / matching). */
  username?: string;
  cookies: StoredCookie[];
  /** Base32 TOTP secret for 2FA-assisted re-auth. Never log or export. */
  totpSecret?: string;
  sessionStatus: AccountSessionStatus;
  savedAt?: number;
  lastSwitchedAt?: number;
  notes?: string;
};

export type AccountStore = {
  accounts: StoredAccount[];
  activeAccountId: string | null;
};

export const DEFAULT_ACCOUNT_STORE: AccountStore = {
  accounts: [],
  activeAccountId: null,
};

/** Subreddit name (lowercase, no r/) → last visit timestamp (ms). */
export type SubredditVisitMap = Record<string, number>;

export type ThreadVisit = {
  /** Thing id e.g. t3_abc123 */
  fullname: string;
  /** Comment count at last visit */
  commentCount: number;
  visitedAt: number;
  /** Optional permalink path for matching */
  path?: string;
};

export type ThreadVisitMap = Record<string, ThreadVisit>;
