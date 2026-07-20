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
export type JsonItemCountMode = 'hide' | 'show' | 'threshold';

export type FeatureSettings = {
  reddit: {
    tags: boolean;
    ignore: boolean;
    accountSwitcher: boolean;
    infiniteScroll: boolean;
    subredditVisits: boolean;
    newCommentCounts: boolean;
    tagBadgeStyle: TagBadgeStyle;
  };
  jsonFormatter: {
    enabled: boolean;
    darkMode: 'system' | 'light' | 'dark';
    showArrayIndices: boolean;
    itemCountMode: JsonItemCountMode;
    itemCountThreshold: number;
  };
  google: {
    mapsButton: boolean;
    viewImage: boolean;
  };
  youtube: {
    removeShorts: boolean;
  };
  summarizer: {
    enabled: boolean;
    provider: string;
    /** Legacy/default alias — mirrors models.brief. */
    model: string;
    /** Per summary-style model defaults (brief / bullets / detailed). */
    models: {
      brief: string;
      bullets: string;
      detailed: string;
    };
  };
};

/** Kept as an alias so existing imports survive the versioned settings migration. */
export type Settings = FeatureSettings;

export type SettingsPatch = {
  reddit?: Partial<FeatureSettings['reddit']>;
  jsonFormatter?: Partial<FeatureSettings['jsonFormatter']>;
  google?: Partial<FeatureSettings['google']>;
  youtube?: Partial<FeatureSettings['youtube']>;
  summarizer?: Partial<FeatureSettings['summarizer']>;
};

export type LegacySettings = {
  enableTags?: boolean;
  enableIgnore?: boolean;
  enableOldRedditInfiniteScroll?: boolean;
  enableSubredditLastVisited?: boolean;
  enableNewCommentCounts?: boolean;
  tagBadgeStyle?: TagBadgeStyle;
};

export const DEFAULT_SETTINGS: FeatureSettings = {
  reddit: {
    tags: true,
    ignore: true,
    accountSwitcher: true,
    infiniteScroll: true,
    subredditVisits: true,
    newCommentCounts: true,
    tagBadgeStyle: 'pill',
  },
  jsonFormatter: {
    enabled: true,
    darkMode: 'system',
    showArrayIndices: false,
    itemCountMode: 'hide',
    itemCountThreshold: 15,
  },
  google: { mapsButton: true, viewImage: true },
  youtube: { removeShorts: false },
  summarizer: {
    enabled: true,
    provider: 'openai',
    model: '',
    models: { brief: '', bullets: '', detailed: '' },
  },
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

export type AccountRecoveryState = {
  createdAt: number;
  targetAccountId: string;
  previousAccountId: string | null;
  previousCookies: StoredCookie[];
  reason: string;
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
