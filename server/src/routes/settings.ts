import { Router } from 'express';
import { z } from 'zod';
import { asc } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { users } from '../db/schema.js';
import { requireAdmin, requireAuth } from '../middleware/auth.js';
import { ApiError } from '../middleware/errors.js';
import { getScoringConfig, saveScoringConfig, scoringConfigSchema } from '../db/settings.js';
import { analysisConfig, env } from '../config.js';

const router = Router();
router.use(requireAuth);

/** GET /api/settings/scoring — current scoring configuration. */
router.get('/scoring', async (_req, res) => {
  const config = await getScoringConfig();
  res.json({ ok: true, data: { config } });
});

/** PUT /api/settings/scoring — update scoring config (admin only). */
router.put('/scoring', requireAdmin, async (req, res) => {
  const current = await getScoringConfig();
  const merged = scoringConfigSchema.parse({
    ...current,
    ...(typeof req.body === 'object' && req.body !== null ? req.body : {}),
  });
  if (Object.keys(merged.categoryFit).length === 0) {
    throw new ApiError(400, 'Scoring configuration needs at least one category fit value.');
  }
  const next = { ...merged, version: `${merged.version.split('+')[0]}+${Date.now()}` };
  await saveScoringConfig(next);
  res.json({ ok: true, data: { config: next } });
});

/** GET /api/settings/analysis — effective analyzer settings (from env). */
router.get('/analysis', (_req, res) => {
  const cfg = analysisConfig();
  res.json({
    ok: true,
    data: {
      analysis: {
        ...cfg,
        minConfidence: env.OVERTURE_MIN_CONFIDENCE,
        importMaxRecords: env.IMPORT_MAX_RECORDS,
      },
      note: 'Analyzer limits are environment variables — see .env.example.',
    },
  });
});

/** GET /api/settings/users — team members (for lead assignment). */
router.get('/users', async (_req, res) => {
  const db = getDb();
  const rows = await db
    .select({ id: users.id, name: users.name, email: users.email, role: users.role })
    .from(users)
    .orderBy(asc(users.name));
  res.json({ ok: true, data: { users: rows } });
});

export default router;
