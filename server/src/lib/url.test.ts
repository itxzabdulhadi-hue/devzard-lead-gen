import { describe, expect, it } from 'vitest';
import { normalizeWebsite, websiteDomain, isHttpUrl, sameHost, ensureScheme, InvalidUrlError } from './url.js';

describe('normalizeWebsite', () => {
  it('adds https to bare domains', () => {
    expect(normalizeWebsite('example.com')).toBe('https://example.com');
    expect(normalizeWebsite('www.example.com/path')).toBe('https://www.example.com/path');
  });

  it('keeps http and https as provided', () => {
    expect(normalizeWebsite('http://example.com')).toBe('http://example.com');
    expect(normalizeWebsite('HTTPS://EXAMPLE.COM/Page')).toBe('https://example.com/Page');
  });

  it('lowercases the host and strips default ports', () => {
    expect(normalizeWebsite('https://EXAMPLE.com:443/a')).toBe('https://example.com/a');
    expect(normalizeWebsite('http://EXAMPLE.com:80')).toBe('http://example.com');
  });

  it('drops hash fragments and tracking parameters', () => {
    expect(normalizeWebsite('https://example.com/page#section')).toBe('https://example.com/page');
    expect(
      normalizeWebsite('https://example.com/?utm_source=x&id=7'),
    ).toBe('https://example.com/?id=7');
  });

  it('returns null for unusable input', () => {
    expect(normalizeWebsite(null)).toBeNull();
    expect(normalizeWebsite('')).toBeNull();
    expect(normalizeWebsite('   ')).toBeNull();
    expect(normalizeWebsite('ftp://files.example.com')).toBeNull();
    expect(normalizeWebsite('not a url at all')).toBeNull();
    expect(normalizeWebsite('javascript:alert(1)')).toBeNull();
  });
});

describe('websiteDomain', () => {
  it('extracts the domain without www', () => {
    expect(websiteDomain('https://www.shop.example.com/x?y=1')).toBe('shop.example.com');
    expect(websiteDomain('http://Sub.DOMAIN.example')).toBe('sub.domain.example');
  });

  it('returns null when unusable', () => {
    expect(websiteDomain(null)).toBeNull();
    expect(websiteDomain('nonsense')).toBeNull();
  });
});

describe('isHttpUrl / sameHost / ensureScheme', () => {
  it('isHttpUrl accepts only http(s)', () => {
    expect(isHttpUrl('https://x.com')).toBe(true);
    expect(isHttpUrl('http://x.com')).toBe(true);
    expect(isHttpUrl('ftp://x.com')).toBe(false);
    expect(isHttpUrl('nope')).toBe(false);
  });

  it('sameHost ignores www and scheme', () => {
    expect(sameHost('https://www.a.com/x', 'http://a.com/y')).toBe(true);
    expect(sameHost('https://a.com', 'https://b.com')).toBe(false);
  });

  it('ensureScheme throws on whitespace/garbage', () => {
    expect(ensureScheme('example.com')).toBe('https://example.com');
    expect(() => ensureScheme('two words')).toThrow(InvalidUrlError);
  });
});
