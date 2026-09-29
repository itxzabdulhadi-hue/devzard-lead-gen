/**
 * Overture Maps Places provider.
 *
 * Queries the Overture "places" theme Parquet dataset directly with DuckDB
 * (httpfs) — the dataset is filtered at the source so only selected records
 * are imported into Postgres. No Google Maps scraping, no ToS bypass: Overture
 * places is open data (CDLA Permissive 2.0 / Apache 2.0).
 *
 * Schema note: Overture evolves its schema. Releases since 2026-07 expose
 * `taxonomy` + `basic_category`; older releases expose `categories.primary`.
 * The provider introspects the dataset once and builds matching SQL.
 */
import { duckStringLiteral, ensureHttpFs, getConnection, queryRows, DuckDbError } from '../duckdb.js';
import type { DuckDBValue } from '@duckdb/node-api';
import { overturePlacesUrl, env } from '../../config.js';
import type {
  DataSourceTestResult,
  DiscoveryFilters,
  DiscoveryProvider,
  DiscoveryRecord,
  DiscoveryResult,
} from './types.js';

export const OVERTURE_DEFAULT_URL =
  'https://overturemaps-us-west-2.s3.amazonaws.com/release/2025-06-25.0/THEMES/places.parquet';

/** Common country names → ISO-3166 alpha-2 (addresses[].country is ISO). */
export const COUNTRY_NAMES: Record<string, string> = {
  'united arab emirates': 'AE',
  uae: 'AE',
  'saudi arabia': 'SA',
  qatar: 'QA',
  kuwait: 'KW',
  bahrain: 'BH',
  oman: 'OM',
  egypt: 'EG',
  jordan: 'JO',
  turkey: 'TR',
  turkiye: 'TR',
  germany: 'DE',
  france: 'FR',
  'united kingdom': 'GB',
  uk: 'GB',
  britain: 'GB',
  england: 'GB',
  spain: 'ES',
  italy: 'IT',
  netherlands: 'NL',
  belgium: 'BE',
  portugal: 'PT',
  ireland: 'IE',
  sweden: 'SE',
  norway: 'NO',
  denmark: 'DK',
  finland: 'FI',
  poland: 'PL',
  switzerland: 'CH',
  austria: 'AT',
  greece: 'GR',
  'united states': 'US',
  usa: 'US',
  'united states of america': 'US',
  canada: 'CA',
  mexico: 'MX',
  brazil: 'BR',
  india: 'IN',
  pakistan: 'PK',
  bangladesh: 'BD',
  indonesia: 'ID',
  malaysia: 'MY',
  singapore: 'SG',
  philippines: 'PH',
  thailand: 'TH',
  vietnam: 'VN',
  japan: 'JP',
  'south korea': 'KR',
  korea: 'KR',
  china: 'CN',
  australia: 'AU',
  'new zealand': 'NZ',
  'south africa': 'ZA',
  nigeria: 'NG',
  kenya: 'KE',
  morocco: 'MA',
  tunisia: 'TN',
  lebanon: 'LB',
  iraq: 'IQ',
  israel: 'IL',
};

export function toIsoCountry(input: string | null | undefined): string | null {
  if (!input) return null;
  const value = input.trim().toLowerCase();
  if (!value) return null;
  if (/^[a-z]{2}$/.test(value)) return value.toUpperCase();
  return COUNTRY_NAMES[value] ?? null;
}

function placesUrl(): string {
  return overturePlacesUrl() ?? OVERTURE_DEFAULT_URL;
}

interface DatasetColumns {
  categoryExpr: string;
  hasOperatingStatus: boolean;
  hasConfidence: boolean;
}

async function introspect(fileUrl: string): Promise<DatasetColumns> {
  const rows = await queryRows(`SELECT column_name, parent FROM parquet_schema(${duckStringLiteral(fileUrl)})`);
  const cols = new Set(rows.map((r) => String(r.column_name ?? r['column_name'] ?? '').trim()));
  const has = (c: string) => cols.has(c);
  let categoryExpr = "categories.primary";
  if (has('taxonomy')) {
    categoryExpr = has('basic_category')
      ? 'coalesce(nullif(basic_category, \'\'), taxonomy.primary)'
      : 'taxonomy.primary';
  } else if (has('basic_category')) {
    categoryExpr = 'basic_category';
  }
  return {
    categoryExpr,
    hasOperatingStatus: has('operating_status'),
    hasConfidence: has('confidence'),
  };
}

function buildWhere(
  filters: DiscoveryFilters,
  columns: DatasetColumns,
  minConfidence: number,
): { clauses: string[]; params: DuckDBValue[] } {
  const clauses: string[] = ['names.primary IS NOT NULL', 'bbox.xmin IS NOT NULL'];
  const params: DuckDBValue[] = [];

  const iso = toIsoCountry(filters.country);
  if (iso) {
    clauses.push(
      'len(list_filter(addresses, a -> coalesce(a.country, \'\') = ?)) > 0',
    );
    params.push(iso);
  }
  if (filters.region) {
    clauses.push("len(list_filter(addresses, a -> coalesce(a.region, '') ILIKE ?)) > 0");
    params.push(`%${filters.region}%`);
  }
  if (filters.city) {
    clauses.push("len(list_filter(addresses, a -> coalesce(a.locality, '') ILIKE ?)) > 0");
    params.push(`%${filters.city}%`);
  }
  if (filters.category) {
    clauses.push(`${columns.categoryExpr} ILIKE ?`);
    params.push(`%${filters.category}%`);
  }
  if (filters.keyword) {
    clauses.push('names.primary ILIKE ?');
    params.push(`%${filters.keyword}%`);
  }
  if (columns.hasOperatingStatus) {
    clauses.push("(operating_status IS NULL OR operating_status <> 'permanently_closed')");
  }
  if (columns.hasConfidence && minConfidence > 0) {
    clauses.push('(confidence IS NULL OR confidence >= ?)');
    params.push(minConfidence);
  }
  return { clauses, params };
}


function asNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  if (typeof v === 'bigint') return Number(v);
  return null;
}

function mapRows(rows: Record<string, unknown>[]): DiscoveryRecord[] {
  const out: DiscoveryRecord[] = [];
  for (const r of rows) {
    const id = r.id == null ? null : String(r.id);
    const name = r.name == null ? null : String(r.name);
    if (!id || !name) continue;
    const addr = (r.addr ?? null) as Record<string, unknown> | null;
    const socials = Array.isArray(r.socials) ? r.socials.map(String) : [];
    out.push({
      sourceId: id,
      name,
      category: r.category == null ? null : String(r.category),
      country: addr?.country ? String(addr.country) : null,
      region: addr?.region ? String(addr.region) : null,
      city: addr?.locality ? String(addr.locality) : null,
      address: addr?.freeform ? String(addr.freeform) : null,
      latitude: asNumber(r.lat),
      longitude: asNumber(r.lon),
      phone: Array.isArray(r.phones) && r.phones.length > 0 ? String(r.phones[0]) : null,
      email: Array.isArray(r.emails) && r.emails.length > 0 ? String(r.emails[0]) : null,
      website: Array.isArray(r.websites) && r.websites.length > 0 ? String(r.websites[0]) : null,
      socials,
      confidence: asNumber(r.confidence),
      operatingStatus: r.operating_status == null ? null : String(r.operating_status),
    });
  }
  return out;
}

async function runQuery(sqlText: string, params: DuckDBValue[]): Promise<Record<string, unknown>[]> {
  const conn = await getConnection();
  await ensureHttpFs(conn);
  const rows = await queryRows(sqlText, params);
  return rows as Record<string, unknown>[];
}

export const overtureProvider: DiscoveryProvider = {
  id: 'overture',
  label: 'Overture Maps Places',
  type: 'dataset',
  description:
    'Open place dataset (CDLA-Permissive-2.0 / Apache-2.0) queried directly as Parquet with DuckDB. Records are filtered at the source; only selected businesses are imported.',
  license: 'CDLA Permissive 2.0 / Apache 2.0',
  requiresInternet: true,

  isConfigured() {
    return Boolean(overturePlacesUrl() || env.OVERTURE_DATA_URL === '');
  },

  async search(filters: DiscoveryFilters): Promise<DiscoveryResult> {
    const fileUrl = placesUrl();
    let columns: DatasetColumns;
    try {
      columns = await introspect(fileUrl);
    } catch (err) {
      if (err instanceof DuckDbError) {
        throw new DuckDbError(
          'Overture dataset is not reachable. Check OVERTURE_DATA_URL and internet access.',
          err.detail,
        );
      }
      throw err;
    }
    const { clauses, params } = buildWhere(filters, columns, env.OVERTURE_MIN_CONFIDENCE);
    const where = clauses.join('\n  AND ');

    const selectSql = `SELECT
  id,
  names.primary AS name,
  ${columns.categoryExpr} AS category,
  confidence,
  websites,
  socials,
  emails,
  phones,
  addresses[1] AS addr,
  ${columns.hasOperatingStatus ? 'operating_status' : 'NULL AS operating_status'},
  (bbox.xmin + bbox.xmax) / 2 AS lon,
  (bbox.ymin + bbox.ymax) / 2 AS lat
FROM read_parquet(${duckStringLiteral(fileUrl)})
WHERE ${where}
ORDER BY confidence DESC NULLS LAST
LIMIT ${Math.max(1, Math.floor(filters.limit))}`;

    const [rows, countRows] = await Promise.all([
      runQuery(selectSql, params),
      runQuery(
        `SELECT count(*) AS total FROM read_parquet(${duckStringLiteral(fileUrl)}) WHERE ${where}`,
        params,
      ),
    ]);
    const total = countRows[0]?.total;
    return {
      records: mapRows(rows),
      totalAvailable: typeof total === 'bigint' ? Number(total) : Number(total ?? 0),
    };
  },

  async testConnection(): Promise<DataSourceTestResult> {
    const testedAt = new Date().toISOString();
    try {
      const fileUrl = placesUrl();
      const columns = await introspect(fileUrl);
      const rows = await runQuery(
        `SELECT count(*) AS total FROM read_parquet(${duckStringLiteral(fileUrl)})`,
        [],
      );
      const total = Number(rows[0]?.total ?? 0);
      return {
        ok: true,
        detail: `Connected. ${total.toLocaleString('en-US')} places available. Category column: ${columns.categoryExpr}.`,
        testedAt,
      };
    } catch (err) {
      const detail =
        err instanceof DuckDbError
          ? err.message
          : 'Overture dataset is not reachable from this environment.';
      return { ok: false, detail, testedAt };
    }
  },
};
