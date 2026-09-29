/**
 * Import pipeline: normalize discovery records and persist them into Postgres
 * with deduplication.
 *
 * Dedup rules (in order):
 *   1. (source, source_id) unique — same record re-imported → alreadyExisting
 *   2. normalized website domain already owned by another business → duplicate
 *   3. duplicates inside the incoming batch
 *
 * Imports run in batches (bulk INSERT ... ON CONFLICT) so tens of thousands of
 * records can be imported without per-row round trips.
 */
import { inArray } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { businesses, leads, type NewBusiness } from '../db/schema.js';
import { normalizeWebsite, websiteDomain } from '../lib/url.js';
import { normalizePhone } from '../lib/phone.js';
import { classifySocials } from '../lib/social.js';
import { websiteDedupeKey } from '../lib/dedupe.js';
import type { DiscoveryRecord } from './discovery/types.js';

export interface ImportSummary {
  discovered: number;
  imported: number;
  alreadyExisting: number;
  duplicatesSkipped: number;
  invalidSkipped: number;
  businessIds: string[];
}

const CHUNK_SIZE = 250;

/** Prettify raw source categories: "hair_salon" → "Hair Salon". */
export function prettifyCategory(raw: string | null): string | null {
  if (!raw) return null;
  const value = raw.trim();
  if (!value) return null;
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .split(' ')
    .map((w) => (w.length <= 3 && w === w.toUpperCase() ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

/** Map one discovery record into a storable business row (or null if invalid). */
export function mapRecordToBusiness(record: DiscoveryRecord, source: string): NewBusiness | null {
  const name = String(record.name ?? '').trim();
  const sourceId = String(record.sourceId ?? '').trim();
  if (!name || !sourceId) return null;

  const website = normalizeWebsite(record.website);
  const phone = normalizePhone(record.phone);
  const email = record.email ? String(record.email).trim().toLowerCase() : null;
  const validEmail = email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
  const socials = classifySocials(record.socials);

  const addressParts: string[] = [];
  for (const part of [record.address, record.city]) {
    if (!part) continue;
    const value = String(part).trim();
    if (value && !addressParts.some((existing) => existing.toLowerCase().includes(value.toLowerCase()))) {
      addressParts.push(value);
    }
  }
  const operatingStatus =
    record.operatingStatus === 'permanently_closed' ? 'permanently_closed' : record.operatingStatus ?? null;

  return {
    source,
    sourceId,
    name,
    category: prettifyCategory(record.category),
    country: record.country ? String(record.country).toUpperCase() : null,
    region: record.region ? String(record.region) : null,
    city: record.city ? String(record.city) : null,
    address: addressParts.length > 0 ? addressParts.join(', ') : null,
    latitude: typeof record.latitude === 'number' ? record.latitude : null,
    longitude: typeof record.longitude === 'number' ? record.longitude : null,
    phone,
    email: validEmail,
    website,
    websiteDomain: websiteDomain(website),
    facebook: socials.facebook,
    instagram: socials.instagram,
    linkedin: socials.linkedin,
    operatingStatus,
    sourceConfidence: typeof record.confidence === 'number' ? record.confidence : null,
  };
}

export async function importRecords(
  records: DiscoveryRecord[],
  source: string,
): Promise<ImportSummary> {
  const db = getDb();
  const summary: ImportSummary = {
    discovered: records.length,
    imported: 0,
    alreadyExisting: 0,
    duplicatesSkipped: 0,
    invalidSkipped: 0,
    businessIds: [],
  };

  // 1) Map + normalize + in-batch dedupe.
  const mapped = new Map<string, NewBusiness>();
  const domainsSeen = new Set<string>();
  for (const record of records) {
    const row = mapRecordToBusiness(record, source);
    if (!row) {
      summary.invalidSkipped += 1;
      continue;
    }
    const key = `${source}::${row.sourceId}`;
    if (mapped.has(key)) {
      summary.duplicatesSkipped += 1;
      continue;
    }
    const domain = row.websiteDomain ? websiteDedupeKey(row.website) : null;
    if (domain && domainsSeen.has(domain)) {
      summary.duplicatesSkipped += 1;
      continue;
    }
    if (domain) domainsSeen.add(domain);
    mapped.set(key, row);
  }
  const rows = [...mapped.values()];

  // 2) Skip records that already exist (source+sourceId) or whose website
  //    domain is already present from any source.
  let candidates = rows;
  if (rows.length > 0) {
    const sourceIds = rows.map((r) => r.sourceId);
    const existingKeys = new Set<string>();
    for (let i = 0; i < sourceIds.length; i += CHUNK_SIZE) {
      const slice = sourceIds.slice(i, i + CHUNK_SIZE);
      const found = await db
        .select({ sourceId: businesses.sourceId })
        .from(businesses)
        .where(inArray(businesses.sourceId, slice));
      for (const f of found) existingKeys.add(f.sourceId);
    }
    const kept: NewBusiness[] = [];
    for (const row of rows) {
      if (existingKeys.has(row.sourceId)) {
        summary.alreadyExisting += 1;
        continue;
      }
      kept.push(row);
    }
    candidates = kept;

    const domains = candidates.map((r) => r.websiteDomain).filter((d): d is string => Boolean(d));
    if (domains.length > 0) {
      const takenDomains = new Set<string>();
      for (let i = 0; i < domains.length; i += CHUNK_SIZE) {
        const slice = domains.slice(i, i + CHUNK_SIZE);
        const found = await db
          .select({ domain: businesses.websiteDomain })
          .from(businesses)
          .where(inArray(businesses.websiteDomain, slice));
        for (const f of found) if (f.domain) takenDomains.add(f.domain);
      }
      const finalRows: NewBusiness[] = [];
      for (const row of candidates) {
        if (row.websiteDomain && takenDomains.has(row.websiteDomain)) {
          summary.duplicatesSkipped += 1;
          continue;
        }
        finalRows.push(row);
      }
      candidates = finalRows;
    }
  }

  // 3) Bulk insert in chunks; a concurrent import may still race on the unique
  //    constraint — ON CONFLICT DO NOTHING + RETURNING keeps counts honest.
  for (let i = 0; i < candidates.length; i += CHUNK_SIZE) {
    const chunk = candidates.slice(i, i + CHUNK_SIZE);
    const inserted = await db
      .insert(businesses)
      .values(chunk)
      .onConflictDoNothing()
      .returning({ id: businesses.id, sourceId: businesses.sourceId });
    for (const r of inserted) summary.businessIds.push(r.id);
    summary.imported += inserted.length;

    if (inserted.length > 0) {
      const insertedIds = new Set(inserted.map((r) => r.id));
      const leadValues = inserted
        .filter((r) => insertedIds.has(r.id))
        .map((r) => ({ businessId: r.id, status: 'new' as const }));
      if (leadValues.length > 0) {
        await db.insert(leads).values(leadValues).onConflictDoNothing();
      }
    }
  }

  return summary;
}
