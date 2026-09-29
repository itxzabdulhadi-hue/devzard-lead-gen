import { Router } from 'express';
import { and, count, desc, eq, gte, isNotNull, sql } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { businesses, leadScores, leads, websiteAnalysis } from '../db/schema.js';
import { requireAuth } from '../middleware/auth.js';
import { leadStatuses } from '../lib/filters.js';

const router = Router();
router.use(requireAuth);

/**
 * GET /api/dashboard/stats
 * Every number is computed from the database — nothing is fabricated.
 */
router.get('/stats', async (_req, res) => {
  const db = getDb();

  const [
    totalBusinesses,
    highOpportunity,
    analyzedCount,
    reachableCount,
    statusCounts,
    topCategories,
    topCountries,
    topCities,
    recentLeads,
    pipelineValueByScoreBand,
  ] = await Promise.all([
    db.select({ value: count() }).from(businesses),
    db
      .select({ value: count() })
      .from(leadScores)
      .where(gte(leadScores.totalScore, 70)),
    db.select({ value: count() }).from(websiteAnalysis),
    db
      .select({ value: count() })
      .from(websiteAnalysis)
      .where(eq(websiteAnalysis.reachable, true)),
    db
      .select({ status: leads.status, value: count() })
      .from(leads)
      .groupBy(leads.status),
    db
      .select({
        category: businesses.category,
        value: count(),
        avgScore: sql<number>`coalesce(round(avg(${leadScores.totalScore}))::int, 0)`,
      })
      .from(businesses)
      .leftJoin(leadScores, eq(leadScores.businessId, businesses.id))
      .where(isNotNull(businesses.category))
      .groupBy(businesses.category)
      .orderBy(desc(count()))
      .limit(8),
    db
      .select({
        country: businesses.country,
        value: count(),
        avgScore: sql<number>`coalesce(round(avg(${leadScores.totalScore}))::int, 0)`,
      })
      .from(businesses)
      .leftJoin(leadScores, eq(leadScores.businessId, businesses.id))
      .where(isNotNull(businesses.country))
      .groupBy(businesses.country)
      .orderBy(desc(count()))
      .limit(8),
    db
      .select({
        country: businesses.country,
        city: businesses.city,
        value: count(),
        avgScore: sql<number>`coalesce(round(avg(${leadScores.totalScore}))::int, 0)`,
      })
      .from(businesses)
      .leftJoin(leadScores, eq(leadScores.businessId, businesses.id))
      .where(and(isNotNull(businesses.city), isNotNull(businesses.country)))
      .groupBy(businesses.country, businesses.city)
      .orderBy(desc(count()))
      .limit(8),
    db
      .select({
        id: businesses.id,
        name: businesses.name,
        category: businesses.category,
        city: businesses.city,
        country: businesses.country,
        website: businesses.website,
        score: leadScores.totalScore,
        status: leads.status,
        createdAt: businesses.createdAt,
      })
      .from(businesses)
      .innerJoin(leads, eq(leads.businessId, businesses.id))
      .leftJoin(leadScores, eq(leadScores.businessId, businesses.id))
      .orderBy(desc(businesses.createdAt))
      .limit(8),
    db
      .select({
        band: sql<string>`CASE
          WHEN ${leadScores.totalScore} >= 80 THEN '80-100'
          WHEN ${leadScores.totalScore} >= 70 THEN '70-79'
          WHEN ${leadScores.totalScore} >= 40 THEN '40-69'
          WHEN ${leadScores.totalScore} IS NOT NULL THEN '0-39'
          ELSE 'unscored' END`,
        value: count(),
      })
      .from(businesses)
      .leftJoin(leadScores, eq(leadScores.businessId, businesses.id))
      .groupBy(
        sql`CASE
          WHEN ${leadScores.totalScore} >= 80 THEN '80-100'
          WHEN ${leadScores.totalScore} >= 70 THEN '70-79'
          WHEN ${leadScores.totalScore} >= 40 THEN '40-69'
          WHEN ${leadScores.totalScore} IS NOT NULL THEN '0-39'
          ELSE 'unscored' END`,
      ),
  ]);

  const statusMap = Object.fromEntries(leadStatuses.map((s) => [s, 0]));
  for (const row of statusCounts) statusMap[row.status] = Number(row.value);

  res.json({
    ok: true,
    data: {
      totals: {
        businesses: Number(totalBusinesses[0]?.value ?? 0),
        highOpportunity: Number(highOpportunity[0]?.value ?? 0),
        analyzed: Number(analyzedCount[0]?.value ?? 0),
        reachable: Number(reachableCount[0]?.value ?? 0),
      },
      pipeline: statusMap,
      scoreBands: pipelineValueByScoreBand.map((r) => ({ band: r.band, count: Number(r.value) })),
      topCategories: topCategories.map((r) => ({
        category: r.category ?? 'Unknown',
        count: Number(r.value),
        avgScore: Number(r.avgScore ?? 0),
      })),
      topCountries: topCountries.map((r) => ({
        country: r.country ?? 'Unknown',
        count: Number(r.value),
        avgScore: Number(r.avgScore ?? 0),
      })),
      topCities: topCities.map((r) => ({
        country: r.country ?? '—',
        city: r.city ?? '—',
        count: Number(r.value),
        avgScore: Number(r.avgScore ?? 0),
      })),
      recentLeads,
    },
  });
});

export default router;
