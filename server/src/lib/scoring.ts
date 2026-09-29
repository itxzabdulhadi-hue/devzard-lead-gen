/**
 * Deterministic, explainable lead-opportunity scoring.
 *
 * The score answers ONE question:
 *   "How strong is the available evidence that this business could benefit
 *    from Devzard's web/digital services?"
 * It is NOT a prediction that the business will buy anything.
 *
 * Structure (max 100 points, every point reproducible from stored data):
 *   Website opportunity    0–40
 *   Digital presence       0–30
 *   Business fit           0–20 (configurable category map)
 *   Data quality           0–10
 *
 * Rules never double-count contradictory conditions (e.g. "no website" and
 * "website unreachable" cannot both fire; section totals are capped).
 */
import type { AnalysisSignals } from '../services/analyzerTypes.js';

export interface ScoreInputBusiness {
  name: string;
  website: string | null;
  phone: string | null;
  email: string | null;
  instagram: string | null;
  facebook: string | null;
  linkedin: string | null;
  category: string | null;
  country: string | null;
  city: string | null;
  address: string | null;
  sourceConfidence: number | null;
}

export interface ScoringConfig {
  version: string;
  categoryFit: Record<string, number>;
  /** Maps raw data-source categories onto fit keys (substring, lowercase). */
  categoryAliases: Record<string, string>;
  defaultFitKey: string;
  unknownCategoryFit: number;
  /** Confidence >= this value counts as "high source confidence". */
  highConfidenceThreshold: number;
}

export type SignalCategory = 'website' | 'presence' | 'fit' | 'data_quality';

export interface ScoreSignal {
  type: string;
  category: SignalCategory;
  points: number;
  description: string;
}

export interface ScoreResult {
  websiteScore: number;
  presenceScore: number;
  fitScore: number;
  dataQualityScore: number;
  totalScore: number;
  reasons: { signals: ScoreSignal[] };
  maxTotal: 100;
}

export const SECTION_MAX = { website: 40, presence: 30, fit: 20, data_quality: 10 };

export const DEFAULT_SCORING_CONFIG: ScoringConfig = {
  version: '2025-09-v1',
  categoryFit: {
    restaurant: 20,
    gym: 20,
    salon: 20,
    clinic: 20,
    real_estate: 20,
    local_retail: 18,
    consultant: 15,
    other: 8,
  },
  categoryAliases: {
    restaurant: 'restaurant, cafe, coffee, food, dining, bakery, eatery, shawarma, biryani, grill, sushi, pizza, burger',
    gym: 'gym, fitness, crossfit, yoga, pilates, martial arts, boxing',
    salon: 'salon, beauty, hair, barber, spa, nail, massage, waxing, cosmetics studio',
    clinic: 'clinic, dentist, dental, doctor, medical, health care, healthcare, physio, pharmacy, veterinary',
    real_estate: 'real estate, realty, property, estate agency, brokerage',
    local_retail: 'store, shop, retail, boutique, market, supermarket, grocery, florist, furniture, electronics, clothing',
    consultant: 'consult, agency, marketing, design studio, accounting, law firm, legal, training',
  },
  defaultFitKey: 'other',
  unknownCategoryFit: 0,
  highConfidenceThreshold: 0.8,
};

/** Map a raw category string to a fit key using configured aliases. */
export function matchFitKey(category: string | null, config: ScoringConfig): string | null {
  if (!category) return null;
  const value = category.toLowerCase();
  for (const [key, aliasCsv] of Object.entries(config.categoryAliases)) {
    for (const alias of aliasCsv.split(',')) {
      const a = alias.trim();
      if (a && value.includes(a)) return key;
    }
  }
  // Exact key match as fallback (e.g. category stored as "restaurant")
  const keys = Object.keys(config.categoryFit);
  if (keys.includes(value)) return value;
  return config.defaultFitKey;
}

interface AnalysisView {
  reachable: boolean | null;
  https: boolean | null;
  hasTitle: boolean | null;
  hasMetaDescription: boolean | null;
  hasH1: boolean | null;
  mobileFriendly: boolean | null;
  hasContactInformation: boolean | null;
  hasCta: boolean | null;
  hasBooking: boolean | null;
  hasOrdering: boolean | null;
  ecommerceDetected: boolean | null;
}

function toAnalysisView(analysis: AnalysisSignals | null | undefined): AnalysisView | null {
  if (!analysis) return null;
  return {
    reachable: analysis.reachable ?? null,
    https: analysis.https ?? null,
    hasTitle: analysis.hasTitle ?? null,
    hasMetaDescription: analysis.hasMetaDescription ?? null,
    hasH1: analysis.hasH1 ?? null,
    mobileFriendly: analysis.mobileFriendly ?? null,
    hasContactInformation: analysis.hasContactInformation ?? null,
    hasCta: analysis.hasCta ?? null,
    hasBooking: analysis.hasBooking ?? null,
    hasOrdering: analysis.hasOrdering ?? null,
    ecommerceDetected: analysis.ecommerceDetected ?? null,
  };
}

function isEcommerceTypeBusiness(fitKey: string | null): boolean {
  return fitKey === 'local_retail' || fitKey === 'restaurant';
}

export function computeScore(
  business: ScoreInputBusiness,
  analysis: AnalysisSignals | null | undefined,
  config: ScoringConfig,
): ScoreResult {
  const signals: ScoreSignal[] = [];
  const a = toAnalysisView(analysis);
  const reachable = a?.reachable === true;

  // ── Website opportunity (max 40) ───────────────────────────────────────────
  let websiteScore = 0;
  const noWebsite = !business.website;
  if (noWebsite) {
    websiteScore += 40;
    signals.push({
      type: 'no_website',
      category: 'website',
      points: 40,
      description: 'No business website was found in any public data source.',
    });
  } else if (analysis && a?.reachable === false) {
    websiteScore += 35;
    signals.push({
      type: 'website_unreachable',
      category: 'website',
      points: 35,
      description: 'Website exists but could not be reached during the audit.',
    });
  } else {
    const seoMissing =
      a?.hasTitle === false || a?.hasMetaDescription === false || a?.hasH1 === false;
    const majorTechnical =
      a?.https === false ||
      ((a?.hasTitle === false ? 1 : 0) +
        (a?.hasMetaDescription === false ? 1 : 0) +
        (a?.hasH1 === false ? 1 : 0) >=
        2);
    if (reachable && majorTechnical) {
      websiteScore += 25;
      signals.push({
        type: 'major_technical_issues',
        category: 'website',
        points: 25,
        description:
          a?.https === false
            ? 'Website is reachable but does not use HTTPS (major technical problem).'
            : 'Website is reachable but is missing basic technical elements (HTTPS/title/meta/H1).',
      });
    }
    if (reachable && a?.mobileFriendly === false) {
      websiteScore += 15;
      signals.push({
        type: 'not_mobile_friendly',
        category: 'website',
        points: 15,
        description: 'No mobile viewport configuration detected — site is not mobile-optimized.',
      });
    }
    if (reachable && seoMissing && !majorTechnical) {
      websiteScore += 10;
      signals.push({
        type: 'weak_seo_metadata',
        category: 'website',
        points: 10,
        description: 'Missing basic SEO metadata (title or meta description or H1).',
      });
    }
  }
  websiteScore = Math.min(websiteScore, SECTION_MAX.website);

  // ── Digital presence opportunity (max 30) ──────────────────────────────────
  let presenceScore = 0;
  const hasSocial = Boolean(business.instagram || business.facebook || business.linkedin);
  if (hasSocial && noWebsite) {
    presenceScore += 25;
    signals.push({
      type: 'social_presence_no_website',
      category: 'presence',
      points: 25,
      description: 'Active social profiles exist but the business has no website.',
    });
  }
  const fitKey = matchFitKey(business.category, config);
  if (
    reachable &&
    isEcommerceTypeBusiness(fitKey) &&
    a?.ecommerceDetected === false &&
    a?.hasOrdering === false
  ) {
    presenceScore += 25;
    signals.push({
      type: 'ecommerce_opportunity',
      category: 'presence',
      points: 25,
      description: 'Business type supports online sales/ordering but none was detected on the website.',
    });
  }
  if (reachable && a?.hasContactInformation === false) {
    presenceScore += 15;
    signals.push({
      type: 'weak_conversion_path',
      category: 'presence',
      points: 15,
      description: 'No clear contact path (phone/email/WhatsApp) found on the website.',
    });
  }
  if (reachable && a?.hasCta === false) {
    presenceScore += 10;
    signals.push({
      type: 'no_clear_cta',
      category: 'presence',
      points: 10,
      description: 'No obvious call-to-action (booking, ordering, contact) on the website.',
    });
  }
  presenceScore = Math.min(presenceScore, SECTION_MAX.presence);

  // ── Business fit (max 20) ──────────────────────────────────────────────────
  let fitScore = 0;
  if (business.category) {
    const key = fitKey ?? config.defaultFitKey;
    fitScore = Math.min(config.categoryFit[key] ?? config.categoryFit[config.defaultFitKey] ?? 0, SECTION_MAX.fit);
    if (fitScore > 0) {
      signals.push({
        type: 'business_fit',
        category: 'fit',
        points: fitScore,
        description: `Business category "${business.category}" (fit: ${key}) matches Devzard services.`,
      });
    }
  }

  // ── Data quality (max 10) ──────────────────────────────────────────────────
  let dataQualityScore = 0;
  if (business.phone) {
    dataQualityScore += 3;
    signals.push({
      type: 'dq_phone',
      category: 'data_quality',
      points: 3,
      description: 'Phone number available.',
    });
  }
  if (business.website) {
    dataQualityScore += 2;
    signals.push({
      type: 'dq_website',
      category: 'data_quality',
      points: 2,
      description: 'Website available.',
    });
  }
  if (business.instagram) {
    dataQualityScore += 2;
    signals.push({
      type: 'dq_instagram',
      category: 'data_quality',
      points: 2,
      description: 'Instagram profile available.',
    });
  }
  if (business.address) {
    dataQualityScore += 2;
    signals.push({
      type: 'dq_address',
      category: 'data_quality',
      points: 2,
      description: 'Address available.',
    });
  }
  if (
    business.sourceConfidence !== null &&
    business.sourceConfidence >= config.highConfidenceThreshold
  ) {
    dataQualityScore += 1;
    signals.push({
      type: 'dq_high_confidence',
      category: 'data_quality',
      points: 1,
      description: 'High source data confidence.',
    });
  }
  dataQualityScore = Math.min(dataQualityScore, SECTION_MAX.data_quality);

  const totalScore = websiteScore + presenceScore + fitScore + dataQualityScore;

  return {
    websiteScore,
    presenceScore,
    fitScore,
    dataQualityScore,
    totalScore: Math.min(totalScore, 100),
    reasons: { signals },
    maxTotal: 100,
  };
}
