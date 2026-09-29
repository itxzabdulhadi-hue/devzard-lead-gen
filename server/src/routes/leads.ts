import { Router } from 'express';
import { z } from 'zod';
import { and, count, eq, inArray } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import {
  analysisJobs,
  businesses,
  leadScores,
  leads,
  leadStatusEnum,
  users,
  websiteAnalysis,
} from '../db/schema.js';
import { requireAdmin, requireAuth } from '../middleware/auth.js';
import { ApiError } from '../middleware/errors.js';
import { buildExportCsv, websiteStatusLabel, type ExportRow } from '../lib/csv.js';
import {
  buildLeadConditions,
  buildOrderBy,
  parseListQuery,
} from '../lib/filters.js';
import { recalculateScore } from '../services/scoringService.js';

const router = Router();
router.use(requireAuth);

const listResponse = (rows: unknown, total: number, page: number, pageSize: number) => ({
  data: rows,
  pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
});

/* ── GET /api/leads — server-side filtered, sorted, paginated list ───────── */

router.get('/', async (req, res) => {
  const filters = parseListQuery(req.query as Record<string, unknown>);
  const db = getDb();
  const conds = buildLeadConditions(filters);
  const where = conds.length > 0 ? and(...conds) : undefined;
  const offset = (filters.page - 1) * filters.pageSize;

  const rowsQuery = db
    .select({
      id: businesses.id,
      name: businesses.name,
      category: businesses.category,
      country: businesses.country,
      region: businesses.region,
      city: businesses.city,
      address: businesses.address,
      phone: businesses.phone,
      email: businesses.email,
      website: businesses.website,
      facebook: businesses.facebook,
      instagram: businesses.instagram,
      linkedin: businesses.linkedin,
      source: businesses.source,
      sourceConfidence: businesses.sourceConfidence,
      operatingStatus: businesses.operatingStatus,
      createdAt: businesses.createdAt,
      leadId: leads.id,
      leadStatus: leads.status,
      assignedTo: leads.assignedTo,
      assignedToName: users.name,
      followUpAt: leads.followUpAt,
      tags: leads.tags,
      score: leadScores.totalScore,
      scoreCalculatedAt: leadScores.calculatedAt,
      analyzedAt: websiteAnalysis.analyzedAt,
      reachable: websiteAnalysis.reachable,
      cms: websiteAnalysis.cms,
    })
    .from(businesses)
    .innerJoin(leads, eq(leads.businessId, businesses.id))
    .leftJoin(leadScores, eq(leadScores.businessId, businesses.id))
    .leftJoin(websiteAnalysis, eq(websiteAnalysis.businessId, businesses.id))
    .leftJoin(users, eq(users.id, leads.assignedTo))
    .where(where)
    .orderBy(...buildOrderBy(filters))
    .limit(filters.pageSize)
    .offset(offset);

  const totalQuery = db
    .select({ value: count() })
    .from(businesses)
    .innerJoin(leads, eq(leads.businessId, businesses.id))
    .leftJoin(leadScores, eq(leadScores.businessId, businesses.id))
    .leftJoin(websiteAnalysis, eq(websiteAnalysis.businessId, businesses.id))
    .where(where);

  const [rows, totals] = await Promise.all([rowsQuery, totalQuery]);
  res.json({
    ok: true,
    ...listResponse(rows, Number(totals[0]?.value ?? 0), filters.page, filters.pageSize),
  });
});

/* ── GET /api/leads/export — CSV of the filtered result set ──────────────── */

router.get('/export', async (req, res) => {
  const filters = parseListQuery(req.query as Record<string, unknown>);
  const db = getDb();
  const conds = buildLeadConditions(filters);
  const where = conds.length > 0 ? and(...conds) : undefined;

  const rows = await db
    .select({
      name: businesses.name,
      category: businesses.category,
      country: businesses.country,
      city: businesses.city,
      address: businesses.address,
      phone: businesses.phone,
      email: businesses.email,
      website: businesses.website,
      instagram: businesses.instagram,
      facebook: businesses.facebook,
      linkedin: businesses.linkedin,
      score: leadScores.totalScore,
      scoreReasons: leadScores.reasons,
      reachable: websiteAnalysis.reachable,
      analyzedAt: websiteAnalysis.analyzedAt,
      leadStatus: leads.status,
    })
    .from(businesses)
    .innerJoin(leads, eq(leads.businessId, businesses.id))
    .leftJoin(leadScores, eq(leadScores.businessId, businesses.id))
    .leftJoin(websiteAnalysis, eq(websiteAnalysis.businessId, businesses.id))
    .where(where)
    .orderBy(...buildOrderBy(filters))
    .limit(100_000);

  const exportRows: ExportRow[] = rows.map((r) => {
    const reasons = (r.scoreReasons as { signals?: Array<{ description: string; points: number }> } | null)?.signals ?? [];
    return {
      business_name: r.name,
      category: r.category,
      country: r.country,
      city: r.city,
      address: r.address,
      phone: r.phone,
      email: r.email,
      website: r.website,
      instagram: r.instagram,
      facebook: r.facebook,
      linkedin: r.linkedin,
      opportunity_score: r.score,
      website_status: websiteStatusLabel(r.website, { reachable: r.reachable, analyzedAt: r.analyzedAt }),
      score_reasons: reasons.map((s) => `${s.description} (+${s.points})`).join(' | '),
      lead_status: r.leadStatus,
    };
  });

  const csv = buildExportCsv(exportRows);
  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="devzard-leads-${stamp}.csv"`);
  res.send(csv);
});

/* ── Bulk operations (before :id routes) ─────────────────────────────────── */

const bulkStatusSchema = z.object({
  businessIds: z.array(z.string().uuid()).min(1).max(5000),
  status: z.enum(leadStatusEnum.enumValues),
});

router.post('/bulk-status', async (req, res) => {
  const body = bulkStatusSchema.parse(req.body);
  const db = getDb();
  const now = new Date();
  const updated = await db
    .update(leads)
    .set({
      status: body.status,
      contactedAt: body.status === 'contacted' ? now : undefined,
      updatedAt: now,
    })
    .where(inArray(leads.businessId, body.businessIds))
    .returning({ id: leads.id });
  res.json({ ok: true, data: { updated: updated.length } });
});

const bulkAnalyzeSchema = z.object({
  businessIds: z.array(z.string().uuid()).min(1).max(5000),
});

router.post('/bulk-analyze', async (req, res) => {
  const body = bulkAnalyzeSchema.parse(req.body);
  const db = getDb();
  if (body.businessIds.length > 5000) throw new ApiError(400, 'Too many businesses in one job.');
  const found = await db
    .select({ id: businesses.id })
    .from(businesses)
    .where(inArray(businesses.id, body.businessIds));
  const ids = found.map((f) => f.id);
  if (ids.length === 0) throw new ApiError(404, 'No matching businesses found.');
  const jobs = await db
    .insert(analysisJobs)
    .values({ businessIds: ids, total: ids.length, createdBy: req.user?.id })
    .returning({ id: analysisJobs.id });
  res.status(202).json({ ok: true, data: { jobId: jobs[0]!.id, queued: ids.length } });
});

/* ── GET /api/leads/:id — full lead detail ───────────────────────────────── */

router.get('/:id', async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const db = getDb();

  const rows = await db
    .select({
      business: businesses,
      lead: leads,
      score: leadScores,
      analysis: websiteAnalysis,
    })
    .from(businesses)
    .innerJoin(leads, eq(leads.businessId, businesses.id))
    .leftJoin(leadScores, eq(leadScores.businessId, businesses.id))
    .leftJoin(websiteAnalysis, eq(websiteAnalysis.businessId, businesses.id))
    .where(eq(businesses.id, id))
    .limit(1);

  const row = rows[0];
  if (!row) throw new ApiError(404, 'Lead not found.', 'not_found');

  res.json({ ok: true, data: row });
});

/* ── PATCH /api/leads/:id — CRM updates ──────────────────────────────────── */

const patchSchema = z
  .object({
    status: z.enum(leadStatusEnum.enumValues).optional(),
    notes: z.string().max(10000).nullable().optional(),
    tags: z.array(z.string().trim().min(1).max(50)).max(20).optional(),
    followUpAt: z.coerce.date().nullable().optional(),
    assignedTo: z.string().uuid().nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No changes provided' });

router.patch('/:id', async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const body = patchSchema.parse(req.body);
  const db = getDb();

  if (body.assignedTo) {
    const assignee = await db.select({ id: users.id }).from(users).where(eq(users.id, body.assignedTo)).limit(1);
    if (!assignee[0]) throw new ApiError(400, 'Assigned user does not exist.', 'invalid_assignee');
  }

  const existing = await db.select().from(leads).where(eq(leads.businessId, id)).limit(1);
  if (!existing[0]) throw new ApiError(404, 'Lead not found.', 'not_found');

  const now = new Date();
  const patch: Record<string, unknown> = { updatedAt: now };
  if (body.status !== undefined) {
    patch.status = body.status;
    if (body.status === 'contacted' && !existing[0].contactedAt) patch.contactedAt = now;
  }
  if (body.notes !== undefined) patch.notes = body.notes;
  if (body.tags !== undefined) patch.tags = body.tags;
  if (body.followUpAt !== undefined) patch.followUpAt = body.followUpAt;
  if (body.assignedTo !== undefined) patch.assignedTo = body.assignedTo;

  const updated = await db.update(leads).set(patch).where(eq(leads.businessId, id)).returning();
  res.json({ ok: true, data: { lead: updated[0] } });
});

/* ── POST /api/leads/:id/analyze — single synchronous analysis ───────────── */

router.post('/:id/analyze', async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const db = getDb();
  const rows = await db
    .select({ id: businesses.id, website: businesses.website })
    .from(businesses)
    .where(eq(businesses.id, id))
    .limit(1);
  const business = rows[0];
  if (!business) throw new ApiError(404, 'Lead not found.', 'not_found');
  if (!business.website) {
    // Still recalculate: "no website" is itself the strongest signal.
    await recalculateScore(id);
    throw new ApiError(422, 'This business does not have a detected website.', 'no_website');
  }

  const { analyzeWebsite } = await import('../services/analyzer.js');
  const outcome = await analyzeWebsite(business.website);
  await db
    .insert(websiteAnalysis)
    .values({ businessId: id, ...outcome.signals, error: outcome.error, analyzedAt: new Date() })
    .onConflictDoUpdate({
      target: websiteAnalysis.businessId,
      set: { ...outcome.signals, error: outcome.error, analyzedAt: new Date() },
    });
  await recalculateScore(id);

  const analysis = await db.select().from(websiteAnalysis).where(eq(websiteAnalysis.businessId, id)).limit(1);
  const score = await db.select().from(leadScores).where(eq(leadScores.businessId, id)).limit(1);
  res.json({
    ok: true,
    data: { analysis: analysis[0], score: score[0], warning: outcome.error ?? null },
  });
});

/* ── DELETE /api/leads/:id — remove a business + lead (admin only) ───────── */

router.delete('/:id', requireAdmin, async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const db = getDb();
  const deleted = await db.delete(businesses).where(eq(businesses.id, id)).returning({ id: businesses.id });
  if (!deleted[0]) throw new ApiError(404, 'Lead not found.', 'not_found');
  res.json({ ok: true, data: { deleted: deleted[0].id } });
});

export default router;
