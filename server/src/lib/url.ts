/**
 * URL normalization helpers for business websites.
 * Deterministic and unit-tested — used at import time and inside the analyzer.
 */

const TRACKING_PARAMS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'gclid',
  'fbclid',
  'msclkid',
  'ref',
  'referrer',
];

export class InvalidUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidUrlError';
  }
}

/** Ensure the URL has a scheme; bare domains get https://. */
export function ensureScheme(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) throw new InvalidUrlError('Empty URL');
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed;
  // Reject values that clearly are not websites (e.g. "some text")
  if (/\s/.test(trimmed)) throw new InvalidUrlError(`URL contains whitespace: ${trimmed}`);
  return `https://${trimmed}`;
}

/** Validate + normalize a business website URL. Returns null when unusable. */
export function normalizeWebsite(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const value = String(raw).trim();
  if (!value || value === 'null' || value === 'undefined') return null;
  try {
    const url = new URL(ensureScheme(value));
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (!url.hostname.includes('.') && url.hostname !== 'localhost') return null;
    // Lowercase host, drop default ports, drop hash, strip tracking params.
    url.protocol = url.protocol.toLowerCase();
    url.hostname = url.hostname.toLowerCase();
    if (
      (url.protocol === 'https:' && url.port === '443') ||
      (url.protocol === 'http:' && url.port === '80')
    ) {
      url.port = '';
    }
    url.hash = '';
    for (const p of TRACKING_PARAMS) url.searchParams.delete(p);
    const out = url.toString();
    // Trim trailing slash on the root path for tidiness (keep it elsewhere).
    return out.endsWith('/') && url.pathname === '/' ? out.slice(0, -1) : out;
  } catch {
    return null;
  }
}

/** Registrable-looking domain (host, without www.) used for deduplication. */
export function websiteDomain(raw: string | null | undefined): string | null {
  const normalized = normalizeWebsite(raw);
  if (!normalized) return null;
  try {
    const host = new URL(normalized).hostname;
    return host.startsWith('www.') ? host.slice(4) : host;
  } catch {
    return null;
  }
}

/** True when the URL is http(s) and parseable. Used by the analyzer pre-check. */
export function isHttpUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Same-host check used for internal-link sampling during analysis. */
export function sameHost(a: string, b: string): boolean {
  try {
    return websiteDomain(a) === websiteDomain(b);
  } catch {
    return false;
  }
}
