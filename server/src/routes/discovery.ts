import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../db/client.js';
import { analysisJobs } from '../db/schema.js';
import { requireAuth } from '../middleware/auth.js';
import { ApiError } from '../middleware/errors.js';
import { discoveryLimiter } from '../middleware/rateLimit.js';
import { defaultProviderId, getProvider } from '../services/discovery/index.js';
import { importRecords } from '../services/importer.js';
import { env } from '../config.js';

const router = Router();
router.use(requireAuth);

const discoverySchema = z.object({
  provider: z.string().trim().max(50).optional(),
  country: z.string().trim().max(100).optional(),
  region: z.string().trim().max(100).optional(),
  city: z.string().trim().max(100).optional(),
  category: z.string().trim().max(100).optional(),
  keyword: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(env.IMPORT_MAX_RECORDS).default(100),
});

function checkFilters(v: z.infer<typeof discoverySchema>): void {
  if (!v.country && !v.city && !v.region && !v.category && !v.keyword) {
    throw new ApiError(
      400,
      'Add at least one filter (country, region, city, category or keyword) before searching.',
      'no_filters',
    );
  }
}

/**
 * POST /api/leads/search
 * Discover businesses at the data source (Overture / fixture). Nothing is
 * imported; the response contains counts plus a small preview.
 */
router.post('/search', discoveryLimiter, async (req, res) => {
  const body = discoverySchema.parse(req.body);
  checkFilters(body);
  const providerId = body.provider ?? defaultProviderId();
  const provider = getProvider(providerId);
  if (!provider) throw new ApiError(400, `Unknown data source "${providerId}".`, 'unknown_provider');
  if (!provider.isConfigured()) {
    throw new ApiError(
      503,
      'This data source is not configured. Check the data source configuration in Settings.',
      'provider_unconfigured',
    );
  }

  try {
    const result = await provider.search({
      country: body.country,
      region: body.region,
      city: body.city,
      category: body.category,
      keyword: body.keyword,
      limit: body.limit,
    });
    res.json({
      ok: true,
      data: {
        provider: { id: provider.id, label: provider.label, requiresInternet: provider.requiresInternet },
        discovered: result.totalAvailable ?? result.records.length,
        importedPreviewCount: Math.min(result.records.length, body.limit),
        preview: result.records.slice(0, 20),
      },
    });
  } catch (err) {
    throw new ApiError(
      502,
      'Business data search failed. Check the data source configuration.',
      'discovery_failed',
      process.env.NODE_ENV !== 'production' ? { detail: (err as Error).message } : undefined,
    );
  }
});

/**
 * POST /api/leads/import
 * Run the same discovery and import the records into Postgres with
 * deduplication. Optionally queue website analysis for the imported set.
 */
const importSchema = discoverySchema.extend({
  analyzeAfterImport: z.coerce.boolean().default(false),
});

router.post('/import', discoveryLimiter, async (req, res) => {
  const body = importSchema.parse(req.body);
  checkFilters(body);
  const providerId = body.provider ?? defaultProviderId();
  const provider = getProvider(providerId);
  if (!provider) throw new ApiError(400, `Unknown data source "${providerId}".`, 'unknown_provider');
  if (!provider.isConfigured()) {
    throw new ApiError(
      503,
      'Business data import failed. Check the data source configuration.',
      'provider_unconfigured',
    );
  }

  let records;
  try {
    const result = await provider.search({
      country: body.country,
      region: body.region,
      city: body.city,
      category: body.category,
      keyword: body.keyword,
      limit: body.limit,
    });
    records = result.records;
  } catch (err) {
    throw new ApiError(
      502,
      'Business data import failed. Check the data source configuration.',
      'import_search_failed',
      process.env.NODE_ENV !== 'production' ? { detail: (err as Error).message } : undefined,
    );
  }

  const summary = await importRecords(records, provider.id);
  let jobId: string | null = null;
  if (body.analyzeAfterImport && summary.businessIds.length > 0) {
    const db = getDb();
    const jobs = await db
      .insert(analysisJobs)
      .values({
        businessIds: summary.businessIds,
        total: summary.businessIds.length,
        createdBy: req.user?.id,
      })
      .returning({ id: analysisJobs.id });
    jobId = jobs[0]?.id ?? null;
  }

  res.json({
    ok: true,
    data: {
      ...summary,
      analysisJobId: jobId,
      message:
        summary.imported === 0
          ? `No new businesses imported (${summary.alreadyExisting} already existed, ${summary.duplicatesSkipped} duplicates skipped).`
          : `Imported ${summary.imported} businesses.`,
    },
  });
});

export default router;
