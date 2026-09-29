import { describe, expect, it } from 'vitest';
import { normalizePhone, formatPhone } from './phone.js';

describe('normalizePhone', () => {
  it('canonicalizes common formats to E.164', () => {
    expect(normalizePhone('+971 50 123 4567')).toBe('+971501234567');
    expect(normalizePhone('+971 (0)4 1234567')).toBe('+97141234567');
    expect(normalizePhone('00971501234567')).toBe('+971501234567');
    expect(normalizePhone('04-398-6644')).toBe('+043986644'); // no country info → keep digits
    expect(normalizePhone('+1 (555) 123-4567')).toBe('+15551234567');
  });

  it('strips national trunk zero after a plus prefix', () => {
    expect(normalizePhone('+971 04 398 6644')).toBe('+97143986644');
  });

  it('returns null for invalid input', () => {
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone('')).toBeNull();
    expect(normalizePhone('no digits here')).toBeNull();
    expect(normalizePhone('12')).toBeNull(); // too short
    expect(normalizePhone('+1234567890123456789')).toBeNull(); // too long
  });
});

describe('formatPhone', () => {
  it('formats for display', () => {
    expect(formatPhone('+971501234567')).toBe('+971 501 234 567');
    expect(formatPhone('04-398-6644')).toBe('+04 398 664 4');
    expect(formatPhone(null)).toBeNull();
  });
});
