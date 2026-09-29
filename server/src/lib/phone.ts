/**
 * Phone normalization: store numbers in a canonical, comparable form
 * (E.164-style with a leading + and digits only).
 */

export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const value = String(raw).trim();
  if (!value) return null;

  // Keep an explicit leading + (international format), strip everything else.
  const hadPlus = value.startsWith('+') || value.startsWith('00');
  let digits = value.replace(/\D/g, '');
  if (!digits) return null;
  if (value.startsWith('00')) digits = digits.replace(/^00/, '');

  if (hadPlus) {
    // Drop national trunk zeros: right after a leading zero-prefix (already
    // handled) and right after a known country code — "+971 (0)4 123 4567"
    // normalizes to +97141234567 per ITU-T E.164 (no trunk zero).
    digits = digits.replace(/^0+/, '');
    for (const cc of KNOWN_COUNTRY_CODES) {
      if (digits.startsWith(cc) && digits[cc.length] === '0') {
        digits = cc + digits.slice(cc.length + 1);
        break;
      }
    }
  }

  const normalized = `+${digits}`;
  // Sanity: international numbers are 7–15 digits (ITU-T E.164).
  if (normalized.length < 8 || normalized.length > 16) return null;
  return normalized;
}

/** Country calling codes used only for trunk-zero cleanup (longest match wins). */
const KNOWN_COUNTRY_CODES = [
  '971', '966', '974', '973', '968', '965', '962', '961', '20', '212',
  '90', '91', '92', '94', '98', '60', '61', '62', '63', '65', '66',
  '81', '82', '86', '852', '44', '49', '39', '34', '33', '31', '32',
  '41', '43', '30', '351', '7', '1',
];

/** Loose human formatting for display: +971 50 123 4567 style grouping. */
export function formatPhone(raw: string | null | undefined): string | null {
  const n = normalizePhone(raw);
  if (!n) return null;
  const digits = n.slice(1);
  if (digits.length <= 4) return n;
  const cc = digits.length >= 10 ? digits.slice(0, 3) : digits.slice(0, 2);
  const rest = digits.slice(cc.length);
  const chunks = rest.match(/.{1,3}/g) ?? [rest];
  return `+${cc} ${chunks.join(' ')}`.trim();
}
