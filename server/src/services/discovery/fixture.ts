/**
 * Local fixture provider.
 *
 * Serves the same interface as the Overture provider but reads a bundled
 * Parquet file (fixtures/places-fixture.parquet) with DuckDB. It exists so
 * the full pipeline (search → import → analyze → score → export) can be
 * developed, demonstrated and tested in environments without internet access
 * to the Overture dataset.
 *
 * The fixture is generated with `npm run fixtures:generate` and mirrors the
 * Overture places schema shape, so the fixture provider exercises the same
 * query/mapping code path as the real integration.
 */
import fs from 'node:fs';
import { duckStringLiteral, getConnection, queryRows, DuckDbError } from '../duckdb.js';
import type { DuckDBValue } from '@duckdb/node-api';
import { fixturePlacesPath } from '../../config.js';
import { toIsoCountry } from './overture.js';
import type {
  DataSourceTestResult,
  DiscoveryFilters,
  DiscoveryProvider,
  DiscoveryRecord,
  DiscoveryResult,
} from './types.js';


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

function fixturePath(): string {
  return fixturePlacesPath();
}

function isAvailable(): boolean {
  try {
    return fs.existsSync(fixturePath());
  } catch {
    return false;
  }
}

export const fixtureProvider: DiscoveryProvider = {
  id: 'fixture',
  label: 'Local fixture dataset (offline demo)',
  type: 'local-fixture',
  description:
    'Bundled sample Parquet dataset (Dubai / Abu Dhabi businesses) with the same schema as Overture places. Used for offline development, demos and tests.',
  license: 'Synthetic test data',
  requiresInternet: false,

  isConfigured() {
    return isAvailable();
  },

  async search(filters: DiscoveryFilters): Promise<DiscoveryResult> {
    const file = fixturePath();
    if (!fs.existsSync(file)) {
      throw new DuckDbError(
        'Fixture dataset not found. Run `npm run fixtures:generate` to create it.',
      );
    }
    const clauses: string[] = ['names.primary IS NOT NULL', 'bbox.xmin IS NOT NULL'];
    const params: DuckDBValue[] = [];
    const iso = toIsoCountry(filters.country);
    if (iso) {
      clauses.push("len(list_filter(addresses, a -> coalesce(a.country, '') = ?)) > 0");
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
      clauses.push('coalesce(nullif(basic_category, \'\'), taxonomy.primary) ILIKE ?');
      params.push(`%${filters.category}%`);
    }
    if (filters.keyword) {
      clauses.push('names.primary ILIKE ?');
      params.push(`%${filters.keyword}%`);
    }
    const where = clauses.join('\n  AND ');
    const sqlText = `SELECT
  id,
  names.primary AS name,
  coalesce(nullif(basic_category, ''), taxonomy.primary) AS category,
  confidence,
  websites,
  socials,
  emails,
  phones,
  addresses[1] AS addr,
  operating_status,
  (bbox.xmin + bbox.xmax) / 2 AS lon,
  (bbox.ymin + bbox.ymax) / 2 AS lat
FROM read_parquet(${duckStringLiteral(file)})
WHERE ${where}
ORDER BY confidence DESC NULLS LAST
LIMIT ${Math.max(1, Math.floor(filters.limit))}`;

    const [rows, countRows] = await Promise.all([
      queryRows(sqlText, params),
      queryRows(`SELECT count(*) AS total FROM read_parquet(${duckStringLiteral(file)}) WHERE ${where}`, params),
    ]);
    const total = countRows[0]?.total;
    return {
      records: mapRows(rows as Record<string, unknown>[]),
      totalAvailable: typeof total === 'bigint' ? Number(total) : Number(total ?? 0),
    };
  },

  async testConnection(): Promise<DataSourceTestResult> {
    const testedAt = new Date().toISOString();
    const file = fixturePath();
    if (!fs.existsSync(file)) {
      return {
        ok: false,
        detail: 'Fixture dataset not found — run `npm run fixtures:generate`.',
        testedAt,
      };
    }
    try {
      await getConnection();
      const rows = await queryRows(`SELECT count(*) AS total FROM read_parquet(${duckStringLiteral(file)})`);
      const total = Number(rows[0]?.total ?? 0);
      return { ok: true, detail: `Fixture loaded. ${total.toLocaleString('en-US')} sample records.`, testedAt };
    } catch (err) {
      return { ok: false, detail: `Fixture error: ${(err as Error).message}`, testedAt };
    }
  },
};
