import type { LinchpinMessage } from './messages';

type RedditMe = {
  data?: {
    name?: string;
    modhash?: string;
  } | null;
};

type RedditLoginResponse = {
  success?: boolean;
  jquery?: unknown;
  json?: {
    errors?: unknown[];
  };
};

export type RedditLoginResult = { ok: true; username: string } | { ok: false; error: string };

async function redditFetch(path: string, init?: RequestInit): Promise<Response> {
  const url = new URL(path, window.location.origin);
  return fetch(url, {
    ...init,
    credentials: 'include',
    cache: 'no-store',
  });
}

async function getCurrentRedditUser(): Promise<{ username: string; modhash: string } | null> {
  const response = await redditFetch('/api/me.json?raw_json=1&app=res');
  if (!response.ok) throw new Error(`Reddit session check failed (${response.status})`);
  const payload = (await response.json()) as RedditMe;
  const username = payload.data?.name;
  if (!username) return null;
  return { username, modhash: payload.data?.modhash ?? '' };
}

async function logoutCurrentRedditUser(): Promise<void> {
  const current = await getCurrentRedditUser();
  if (!current) return;

  const headers = new Headers();
  if (current.modhash) headers.set('X-Modhash', current.modhash);

  // Reddit keeps a compatibility path for RES's legacy account switcher. Match
  // its request shape: app=res, an optional modhash header, and no form body.
  const response = await redditFetch('/logout?app=res', {
    method: 'POST',
    headers,
  });
  if (!response.ok) throw new Error(`Reddit logout failed (${response.status})`);
}

function loginErrors(payload: RedditLoginResponse): string[] {
  const errors = payload.json?.errors;
  if (!Array.isArray(errors)) return [];
  return errors.flatMap((entry) => {
    if (Array.isArray(entry)) return entry.map(String);
    return [String(entry)];
  });
}

function friendlyLoginError(payload: RedditLoginResponse, status: number): string {
  const details = [...loginErrors(payload), JSON.stringify(payload.jquery ?? '')]
    .join(' ')
    .toUpperCase();
  if (details.includes('WRONG_OTP')) return 'Reddit rejected the TOTP code';
  if (details.includes('PASSWORD') || details.includes('WRONG_PASSWORD')) {
    return 'Reddit rejected the username or password';
  }
  if (details.includes('RATELIMIT')) return 'Reddit rate-limited the login; wait and try again';
  if (details.includes('CAPTCHA')) return 'Reddit requires a CAPTCHA; sign in manually once';
  return `Reddit login failed${status ? ` (${status})` : ''}`;
}

async function loginToReddit(username: string, password: string, otp?: string): Promise<string> {
  const body = new URLSearchParams({
    user: username,
    passwd: password,
    rem: 'on',
  });
  if (otp) body.set('otp', otp);

  // Match the successful RES compatibility request exactly; Reddit's security
  // edge rejects the generic legacy-login shape used previously.
  const response = await redditFetch('/api/login?app=res', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  let payload: RedditLoginResponse = {};
  const responseText = await response.text();
  try {
    payload = JSON.parse(responseText) as RedditLoginResponse;
  } catch {
    // Verification below remains authoritative for non-JSON success responses.
  }
  if (response.status === 403 && /blocked by network security/i.test(responseText)) {
    throw new Error('Reddit blocked the legacy account login request (403)');
  }
  const errors = loginErrors(payload);
  if (!response.ok || errors.length > 0 || payload.success === false) {
    throw new Error(friendlyLoginError(payload, response.status));
  }

  const current = await getCurrentRedditUser();
  if (!current) throw new Error('Reddit did not create a logged-in session');
  if (current.username.localeCompare(username, undefined, { sensitivity: 'base' }) !== 0) {
    throw new Error(`Reddit logged in as u/${current.username}, not u/${username}`);
  }
  return current.username;
}

export async function executeRedditLogin(
  message: Extract<LinchpinMessage, { type: 'linchpin:reddit-login' }>,
): Promise<RedditLoginResult> {
  try {
    await logoutCurrentRedditUser();
    const username = await loginToReddit(message.username, message.password, message.otp);
    return { ok: true, username };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Reddit login failed',
    };
  }
}
