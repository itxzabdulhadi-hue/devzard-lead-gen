/**
 * Score persistence: recompute the deterministic score for a business from
 * stored data (business + latest website analysis + stored scoring config)
 * and upsert it into lead_scores. Fully reproducible.
 */
import { getDb } from '../db/client.js';
import { businesses, leadScores, websiteAnalysis } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { computeScore, type ScoringConfig } from '../lib/scoring.js';
import { getScoringConfig } from '../db/settings.js';
import type { AnalysisSignals } from './analyzerTypes.js';

export async function recalculateScore(
  businessId: string,
  configOverride?: ScoringConfig,
): Promise<{ totalScore: number } | null> {
  const db = getDb();
  const businessRows = await db.select().from(businesses).where(eq(businesses.id, businessId)).limit(1);
  const business = businessRows[0];
  if (!business) return null;

  const analysisRows = await db
    .select()
    .from(websiteAnalysis)
    .where(eq(websiteAnalysis.businessId, businessId))
    .limit(1);
  const analysis = analysisRows[0] ?? null;

  const config = configOverride ?? (await getScoringConfig());

  const signals: AnalysisSignals | null = analysis
    ? {
        reachable: analysis.reachable,
        https: analysis.https,
        responseStatus: analysis.responseStatus,
        responseMs: analysis.responseMs,
        mobileFriendly: analysis.mobileFriendly,
        hasTitle: analysis.hasTitle,
        hasMetaDescription: analysis.hasMetaDescription,
        hasH1: analysis.hasH1,
        hasContactPage: analysis.hasContactPage,
        hasContactInformation: analysis.hasContactInformation,
        hasWhatsapp: analysis.hasWhatsapp,
        hasSocialLinks: analysis.hasSocialLinks,
        hasCta: analysis.hasCta,
        hasBooking: analysis.hasBooking,
        hasOrdering: analysis.hasOrdering,
        ecommerceDetected: analysis.ecommerceDetected,
        cms: analysis.cms,
        robotsTxt: analysis.robotsTxt,
        sitemap: analysis.sitemap,
        canonical: analysis.canonical,
        structuredData: analysis.structuredData,
        brokenLinksCount: analysis.brokenLinksCount,
      }
    : null;

  const result = computeScore(
    {
      name: business.name,
      website: business.website,
      phone: business.phone,
      email: business.email,
      instagram: business.instagram,
      facebook: business.facebook,
      linkedin: business.linkedin,
      category: business.category,
      country: business.country,
      city: business.city,
      address: business.address,
      sourceConfidence: business.sourceConfidence,
    },
    signals,
    config,
  );

  await db
    .insert(leadScores)
    .values({
      businessId,
      websiteScore: result.websiteScore,
      presenceScore: result.presenceScore,
      fitScore: result.fitScore,
      dataQualityScore: result.dataQualityScore,
      totalScore: result.totalScore,
      reasons: result.reasons,
      configVersion: config.version,
      calculatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: leadScores.businessId,
      set: {
        websiteScore: result.websiteScore,
        presenceScore: result.presenceScore,
        fitScore: result.fitScore,
        dataQualityScore: result.dataQualityScore,
        totalScore: result.totalScore,
        reasons: result.reasons,
        configVersion: config.version,
        calculatedAt: new Date(),
      },
    });

  return { totalScore: result.totalScore };
}
