import { describe, expect, it } from 'vitest';
import {
  computeScore,
  DEFAULT_SCORING_CONFIG,
  matchFitKey,
  SECTION_MAX,
  type ScoringConfig,
} from './scoring.js';
import type { AnalysisSignals } from '../services/analyzerTypes.js';

const config: ScoringConfig = DEFAULT_SCORING_CONFIG;

const baseBusiness = {
  name: 'Test Business',
  website: null,
  phone: null,
  email: null,
  instagram: null,
  facebook: null,
  linkedin: null,
  category: null,
  country: 'AE',
  city: 'Dubai',
  address: null,
  sourceConfidence: null,
};

const goodSite: AnalysisSignals = {
  reachable: true,
  https: true,
  responseStatus: 200,
  responseMs: 120,
  mobileFriendly: true,
  hasTitle: true,
  hasMetaDescription: true,
  hasH1: true,
  hasContactPage: true,
  hasContactInformation: true,
  hasWhatsapp: true,
  hasSocialLinks: true,
  hasCta: true,
  hasBooking: true,
  hasOrdering: true,
  ecommerceDetected: true,
  cms: 'WordPress',
  robotsTxt: true,
  sitemap: true,
  canonical: true,
  structuredData: true,
  brokenLinksCount: 0,
};

describe('computeScore — website opportunity (max 40)', () => {
  it('awards 40 for a missing website', () => {
    const r = computeScore(baseBusiness, null, config);
    expect(r.websiteScore).toBe(40);
    expect(r.reasons.signals.map((s) => s.type)).toContain('no_website');
  });

  it('awards 35 for an unreachable website and does NOT also count technical issues', () => {
    const r = computeScore(
      { ...baseBusiness, website: 'https://dead.example' },
      { ...goodSite, reachable: false, https: null, hasTitle: null, mobileFriendly: null },
      config,
    );
    expect(r.websiteScore).toBe(35);
    const websiteSignals = r.reasons.signals.filter((s) => s.category === 'website');
    expect(websiteSignals.map((s) => s.type)).toEqual(['website_unreachable']);
  });

  it('awards 25 for major technical problems (no HTTPS)', () => {
    const r = computeScore(
      { ...baseBusiness, website: 'http://x.example' },
      { ...goodSite, https: false },
      config,
    );
    expect(r.websiteScore).toBe(25);
    expect(r.reasons.signals.some((s) => s.type === 'major_technical_issues')).toBe(true);
  });

  it('awards 25 for major technical problems (2+ missing basics) instead of 10', () => {
    const r = computeScore(
      { ...baseBusiness, website: 'https://x.example' },
      { ...goodSite, hasTitle: false, hasMetaDescription: false, hasH1: false },
      config,
    );
    expect(r.websiteScore).toBe(25);
  });

  it('awards 10 (not 25) for a single missing SEO element', () => {
    const r = computeScore(
      { ...baseBusiness, website: 'https://x.example' },
      { ...goodSite, hasMetaDescription: false },
      config,
    );
    expect(r.websiteScore).toBe(10);
    expect(r.reasons.signals.map((s) => s.type)).toContain('weak_seo_metadata');
  });

  it('awards 15 for a non-mobile site on top of technical issues, capped at 40', () => {
    const r = computeScore(
      { ...baseBusiness, website: 'https://x.example' },
      { ...goodSite, https: false, mobileFriendly: false },
      config,
    );
    expect(r.websiteScore).toBe(Math.min(25 + 15, SECTION_MAX.website));
  });

  it('awards 0 for a healthy website', () => {
    const r = computeScore({ ...baseBusiness, website: 'https://x.example' }, goodSite, config);
    expect(r.websiteScore).toBe(0);
  });
});

describe('computeScore — presence (max 30)', () => {
  it('awards 25 for social presence without a website', () => {
    const r = computeScore(
      { ...baseBusiness, instagram: 'https://instagram.com/x' },
      null,
      config,
    );
    expect(r.presenceScore).toBe(25);
  });

  it('awards ecommerce gap points for retail without e-commerce functionality', () => {
    const r = computeScore(
      { ...baseBusiness, website: 'https://shop.example', category: 'Clothing Store' },
      { ...goodSite, ecommerceDetected: false, hasOrdering: false },
      config,
    );
    expect(r.presenceScore).toBe(25);
    expect(r.reasons.signals.some((s) => s.type === 'ecommerce_opportunity')).toBe(true);
  });

  it('awards weak conversion (15) and no CTA (10) separately, capped at 30', () => {
    const r = computeScore(
      { ...baseBusiness, website: 'https://x.example', category: 'Consultant' },
      { ...goodSite, hasContactInformation: false, hasCta: false },
      config,
    );
    expect(r.presenceScore).toBe(Math.min(15 + 10, SECTION_MAX.presence));
  });

  it('awards 0 for a strong conversion path', () => {
    const r = computeScore(
      { ...baseBusiness, website: 'https://x.example', category: 'Consultant' },
      goodSite,
      config,
    );
    expect(r.presenceScore).toBe(0);
  });
});

describe('computeScore — business fit (max 20)', () => {
  it('maps categories through aliases and awards configurable points', () => {
    const r = computeScore({ ...baseBusiness, category: 'Italian Restaurant' }, null, config);
    expect(r.fitScore).toBe(20);
    expect(matchFitKey('Italian Restaurant', config)).toBe('restaurant');
  });

  it('respects custom configured weights', () => {
    const custom: ScoringConfig = {
      ...config,
      categoryFit: { ...config.categoryFit, restaurant: 12 },
    };
    const r = computeScore({ ...baseBusiness, category: 'Cafe' }, null, custom);
    expect(r.fitScore).toBe(12);
  });

  it('awards the default fit for unknown categories', () => {
    const r = computeScore({ ...baseBusiness, category: 'Zoo' }, null, config);
    expect(r.fitScore).toBe(config.categoryFit.other);
  });

  it('awards 0 when no category is known', () => {
    const r = computeScore(baseBusiness, null, config);
    expect(r.fitScore).toBe(0);
  });
});

describe('computeScore — data quality (max 10)', () => {
  it('sums all quality signals to exactly 10', () => {
    const r = computeScore(
      {
        ...baseBusiness,
        phone: '+971501234567',
        website: 'https://x.example',
        instagram: 'https://instagram.com/x',
        address: 'Somewhere 1',
        sourceConfidence: 0.9,
      },
      null,
      config,
    );
    expect(r.dataQualityScore).toBe(10);
  });

  it('is 0 with no useful fields', () => {
    const r = computeScore(baseBusiness, null, config);
    expect(r.dataQualityScore).toBe(0);
  });
});

describe('computeScore — totals and determinism', () => {
  it('caps the total at 100', () => {
    const r = computeScore(
      {
        ...baseBusiness,
        website: 'https://x.example',
        phone: '+971501234567',
        instagram: 'https://instagram.com/x',
        address: 'Somewhere 1',
        sourceConfidence: 0.9,
        category: 'Restaurant',
      },
      { ...goodSite, https: false, mobileFriendly: false, hasContactInformation: false, hasCta: false, ecommerceDetected: false, hasOrdering: false },
      config,
    );
    expect(r.totalScore).toBeLessThanOrEqual(100);
    expect(r.maxTotal).toBe(100);
  });

  it('is deterministic for identical inputs', () => {
    const input = { ...baseBusiness, website: 'https://x.example', category: 'Gym' };
    const a = computeScore(input, goodSite, config);
    const b = computeScore(input, goodSite, config);
    expect(a).toEqual(b);
  });

  it('never double counts no_website with website_unreachable', () => {
    const r = computeScore(baseBusiness, { ...goodSite, reachable: false }, config);
    const types = r.reasons.signals.map((s) => s.type);
    expect(types).toContain('no_website');
    expect(types).not.toContain('website_unreachable');
  });
});
