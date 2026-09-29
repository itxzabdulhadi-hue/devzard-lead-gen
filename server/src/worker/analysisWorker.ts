/**
 * Background analysis worker.
 *
 * Runs as a separate Node process (`npm run dev:worker` / `npm run start:worker`).
 * Flow: API creates a queued analysis_jobs row → this worker claims it and
 * processes the businesses with conservative concurrency → for each business:
 * website_analysis is upserted and the lead score is recalculated → job
 * progress counters are updated so the UI can poll status.
 *
 * All limits come from environment variables (see .env.example):
 *   ANALYSIS_CONCURRENCY (5), ANALYSIS_TIMEOUT_MS (10000),
 *   ANALYSIS_DELAY_MS (250) between sites, ANALYSIS_MAX_RETRIES (1),
 *   per-host politeness via ANALYSIS_PER_HOST_DELAY_MS (1000).
 */
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { getDb, closeDb } from '../db/client.js';
import { analysisJobs, businesses, websiteAnalysis } from '../db/schema.js';
import { recalculateScore } from '../services/scoringService.js';
import { analyzeWebsite } from '../services/analyzer.js';
import { analysisConfig, type AnalysisConfig } from '../config.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface ClaimedJob {
  id: string;
  businessIds: string[];
  total: number;
}

/** Atomically claim the oldest queued job (SKIP LOCKED → safe with 2 workers). */
export async function claimNextJob(): Promise<ClaimedJob | null> {
  const db = getDb();
  const result = await db.execute(sql`
    UPDATE analysis_jobs
    SET status = 'running', started_at = now()
    WHERE id = (
      SELECT id FROM analysis_jobs
      WHERE status = 'queued'
      ORDER BY created_at
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, business_ids, total
  `);
  const row = (result.rows as Array<Record<string, unknown>>)[0];
  if (!row) return null;
  return {
    id: String(row.id),
    businessIds: (row.business_ids as string[]) ?? [],
    total: Number(row.total ?? 0),
  };
}

async function updateProgress(
  jobId: string,
  completed: number,
  failed: number,
): Promise<void> {
  const db = getDb();
  await db
    .update(analysisJobs)
    .set({ completed, failed })
    .where(eq(analysisJobs.id, jobId));
}

export async function processJob(job: ClaimedJob, config: AnalysisConfig): Promise<void> {
  const db = getDb();
  const ids = job.businessIds.slice(0, config.maxBatch);
  let completed = 0;
  let failed = 0;

  // Simple bounded-concurrency pool.
  let cursor = 0;
  const workers = Array.from({ length: Math.min(config.concurrency, ids.length) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= ids.length) return;
      const businessId = ids[index]!;
      try {
        const rows = await db
          .select({ id: businesses.id, website: businesses.website })
          .from(businesses)
          .where(eq(businesses.id, businessId))
          .limit(1);
        const business = rows[0];
        if (!business) {
          completed += 1;
          continue;
        }
        if (!business.website) {
          // No website: nothing to analyze — the scoring engine still credits
          // the strongest opportunity signal (no_website). Recalculate score.
          await recalculateScore(businessId);
          completed += 1;
          continue;
        }
        const outcome = await analyzeWebsite(business.website, { config });
        await db
          .insert(websiteAnalysis)
          .values({
            businessId,
            ...outcome.signals,
            error: outcome.error,
            analyzedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: websiteAnalysis.businessId,
            set: { ...outcome.signals, error: outcome.error, analyzedAt: new Date() },
          });
        await recalculateScore(businessId);
        completed += 1;
        // An unreachable site is a valid audit verdict (reachable=false);
        // only count items with no verdict at all as failures.
        if (outcome.error && outcome.signals.reachable === null) failed += 1;
      } catch (err) {
        // Never crash the whole job because one business failed.
        // eslint-disable-next-line no-console
        console.error(`[worker] business ${businessId} failed:`, (err as Error).message);
        failed += 1;
        completed += 1;
        await db
          .insert(websiteAnalysis)
          .values({ businessId, error: `Worker error: ${(err as Error).message}`, analyzedAt: new Date() })
          .onConflictDoUpdate({
            target: websiteAnalysis.businessId,
            set: { error: `Worker error: ${(err as Error).message}`, analyzedAt: new Date() },
          });
      }
      await updateProgress(job.id, completed, failed).catch(() => {});
      if (config.delayMs > 0) await sleep(config.delayMs);
    }
  });
  await Promise.all(workers);

  await db
    .update(analysisJobs)
    .set({ status: 'completed', completed, failed, finishedAt: new Date() })
    .where(and(eq(analysisJobs.id, job.id), eq(analysisJobs.status, 'running')));
}

export interface WorkerHandle {
  stop: () => Promise<void>;
}

export async function runWorkerLoop(pollIntervalMs = 2000): Promise<WorkerHandle> {
  const config = analysisConfig();
  const db = getDb();
  let running = true;
  let current: Promise<void> | null = null;

  // Recover jobs stuck in 'running' (e.g. worker crashed previously) only if
  // they have made no progress in the last 10 minutes.
  await db.execute(sql`
    UPDATE analysis_jobs
    SET status = 'queued', started_at = NULL
    WHERE status = 'running'
      AND started_at < now() - interval '10 minutes'
  `);

  const loop = async () => {
    // eslint-disable-next-line no-console
    console.log(
      `[worker] started (concurrency=${config.concurrency}, timeout=${config.timeoutMs}ms, delay=${config.delayMs}ms, retries=${config.maxRetries}${config.allowPrivateHosts ? ', PRIVATE HOSTS ALLOWED (dev/test only!)' : ''})`,
    );
    while (running) {
      try {
        const job = await claimNextJob();
        if (job) {
          current = processJob(job, config);
          await current;
          current = null;
          continue; // immediately look for the next job
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[worker] loop error:', (err as Error).message);
      }
      await sleep(pollIntervalMs);
    }
    // eslint-disable-next-line no-console
    console.log('[worker] stopped');
  };

  const loopPromise = loop();

  return {
    stop: async () => {
      running = false;
      await loopPromise.catch(() => {});
      if (current) await current.catch(() => {});
      await closeDb();
    },
  };
}

/** Kick off queued jobs listing for API (used by routes/analysis). */
export async function listRecentJobs(limit = 10) {
  const db = getDb();
  return db
    .select()
    .from(analysisJobs)
    .orderBy(sql`${analysisJobs.createdAt} DESC`)
    .limit(limit);
}

export async function getJobById(id: string) {
  const db = getDb();
  const rows = await db.select().from(analysisJobs).where(eq(analysisJobs.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function countBusinessesByIds(ids: string[]): Promise<number> {
  const db = getDb();
  const rows = await db
    .select({ id: businesses.id })
    .from(businesses)
    .where(inArray(businesses.id, ids))
    .orderBy(asc(businesses.createdAt));
  return rows.length;
}
