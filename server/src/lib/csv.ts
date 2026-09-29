/**
 * CSV export generation. Column order follows the product spec.
 * Cells are sanitized against spreadsheet formula injection.
 */
import { stringify } from 'csv-stringify/sync';

export interface ExportRow {
  business_name: string;
  category: string | null;
  country: string | null;
  city: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  instagram: string | null;
  facebook: string | null;
  linkedin: string | null;
  opportunity_score: number | null;
  website_status: string;
  score_reasons: string;
  lead_status: string;
}

/** Prefix dangerous leading characters so Excel/Sheets don't evaluate cells. */
export function sanitizeCsvCell(value: string): string {
  if (/^[=+\-@\t\r]/.test(value)) {
    return `'${value}`;
  }
  return value;
}

export function buildExportCsv(rows: ExportRow[]): string {
  const sanitized = rows.map((row) => {
    const out: Record<string, string | number | null> = {};
    for (const [k, v] of Object.entries(row)) {
      out[k] = typeof v === 'string' ? sanitizeCsvCell(v) : v;
    }
    return out;
  });
  return stringify(sanitized, {
    header: true,
    columns: [
      'business_name',
      'category',
      'country',
      'city',
      'address',
      'phone',
      'email',
      'website',
      'instagram',
      'facebook',
      'linkedin',
      'opportunity_score',
      'website_status',
      'score_reasons',
      'lead_status',
    ],
  });
}

/** Human-readable website status used in the CSV and UI. */
export function websiteStatusLabel(
  website: string | null,
  analysis: { reachable: boolean | null; analyzedAt: Date | null } | null,
): string {
  if (!website) return 'no website';
  if (!analysis || !analysis.analyzedAt) return 'not analyzed';
  if (analysis.reachable === false) return 'unreachable';
  if (analysis.reachable === true) return 'reachable';
  return 'not analyzed';
}
