import { describe, expect, it } from 'vitest';
import { dedupeKey, websiteDedupeKey } from './dedupe.js';

describe('dedupeKey', () => {
  it('combines source and source id case-insensitively', () => {
    expect(dedupeKey('Overture', 'abc-123')).toBe('overture::abc-123');
    expect(dedupeKey('overture', 'abc-123')).toBe('overture::abc-123');
    expect(dedupeKey('fixture', 'abc-123')).not.toBe(dedupeKey('overture', 'abc-123'));
  });
});

describe('websiteDedupeKey', () => {
  it('extracts a comparable host', () => {
    expect(websiteDedupeKey('https://www.Shop.example.com/a')).toBe('shop.example.com');
    expect(websiteDedupeKey('http://shop.example.com')).toBe(websiteDedupeKey('https://www.shop.example.com/b'));
  });

  it('returns null for missing/invalid sites', () => {
    expect(websiteDedupeKey(null)).toBeNull();
    expect(websiteDedupeKey('not-a-url')).toBeNull();
  });
});
