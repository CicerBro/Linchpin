/** Keep Google content-script access intentionally finite and reviewable. */
export const GOOGLE_HOSTS = [
  'www.google.com',
  'www.google.co.uk',
  'www.google.ca',
  'www.google.de',
  'www.google.fr',
  'www.google.es',
  'www.google.pt',
  'www.google.it',
  'www.google.nl',
  'www.google.com.au',
  'www.google.co.jp',
  'www.google.co.in',
  'www.google.com.br',
  'www.google.com.mx',
] as const;

export const GOOGLE_MATCH_PATTERNS = GOOGLE_HOSTS.map((host) => `*://${host}/*`);

export function isSupportedGoogleHost(hostname: string): boolean {
  return (GOOGLE_HOSTS as readonly string[]).includes(hostname.toLowerCase());
}
