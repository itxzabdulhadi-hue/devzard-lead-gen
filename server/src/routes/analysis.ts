import { Router } from 'express';
import { z } from 'zod';
import { desc, eq } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { analysisJobs } from '../db/schema.js';
import { requireAuth } from '../middleware/auth.js';
import { ApiError } from '../middleware/errors.js';

const router = Router();
router.use(requireAuth);

/** GET /api/analysis/jobs — recent jobs (for progress UI). */
router.get('/jobs', async (_req, res) => {
  const db = getDb();
  const rows = await db
    .select({
      id: analysisJobs.id,
      status: analysisJobs.status,
      total: analysisJobs.total,
      completed: analysisJobs.completed,
      failed: analysisJobs.failed,
      error: analysisJobs.error,
      createdAt: analysisJobs.createdAt,
      startedAt: analysisJobs.startedAt,
      finishedAt: analysisJobs.finishedAt,
    })
    .from(analysisJobs)
    .orderBy(desc(analysisJobs.createdAt))
    .limit(20);
  res.json({ ok: true, data: { jobs: rows } });
});

/** GET /api/analysis/jobs/:id — poll a specific job. */
router.get('/jobs/:id', async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const db = getDb();
  const rows = await db.select().from(analysisJobs).where(eq(analysisJobs.id, id)).limit(1);
  const job = rows[0];
  if (!job) throw new ApiError(404, 'Analysis job not found.', 'not_found');
  res.json({ ok: true, data: { job } });
});

export default router;
