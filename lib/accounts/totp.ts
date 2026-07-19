/**
 * RFC 6238 TOTP (HMAC-SHA1, 30s step, 6 digits).
 * Secrets stay in memory only for the compute; never log them.
 */

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function decodeBase32(input: string): Uint8Array {
  const cleaned = input.replace(/[\s\-]/g, '').toUpperCase().replace(/=+$/, '');
  if (!cleaned) throw new Error('Empty TOTP secret');
  let bits = 0;
  let value = 0;
  const out: number[] = [];

  for (const ch of cleaned) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error('Invalid Base32 TOTP secret');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Uint8Array.from(out);
}

function counterBytes(counter: number): Uint8Array {
  const buf = new Uint8Array(8);
  let c = counter;
  for (let i = 7; i >= 0; i--) {
    buf[i] = c & 0xff;
    c = Math.floor(c / 256);
  }
  return buf;
}

function toArrayBuffer(view: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(view.byteLength);
  copy.set(view);
  return copy.buffer;
}

async function hmacSha1(
  key: Uint8Array,
  message: Uint8Array,
): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    toArrayBuffer(key),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, toArrayBuffer(message));
  return new Uint8Array(sig);
}

export type TotpResult = {
  code: string;
  /** Seconds remaining in this time step */
  remaining: number;
  period: number;
};

export async function generateTotp(
  secretBase32: string,
  opts: { period?: number; digits?: number; now?: number } = {},
): Promise<TotpResult> {
  const period = opts.period ?? 30;
  const digits = opts.digits ?? 6;
  const now = opts.now ?? Date.now();
  const counter = Math.floor(now / 1000 / period);
  const remaining = period - (Math.floor(now / 1000) % period);

  const key = decodeBase32(secretBase32);
  const msg = counterBytes(counter);
  const hash = await hmacSha1(key, msg);

  const offset = hash[hash.length - 1] & 0x0f;
  const binary =
    ((hash[offset] & 0x7f) << 24) |
    ((hash[offset + 1] & 0xff) << 16) |
    ((hash[offset + 2] & 0xff) << 8) |
    (hash[offset + 3] & 0xff);

  const otp = binary % 10 ** digits;
  const code = otp.toString().padStart(digits, '0');
  return { code, remaining, period };
}

/** Mask a secret for display (never show full secret in UI lists). */
export function maskSecret(secret: string | undefined): string {
  if (!secret) return '(none)';
  const cleaned = secret.replace(/\s/g, '');
  if (cleaned.length <= 4) return '••••';
  return `••••${cleaned.slice(-4)}`;
}
