/**
 * Settings repository — JSON settings stored in Postgres (settings table).
 * Holds the editable scoring configuration and data-source test results.
 */
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from './client.js';
import { settings } from './schema.js';
import { DEFAULT_SCORING_CONFIG, type ScoringConfig } from '../lib/scoring.js';

export const scoringConfigSchema = z.object({
  version: z.string().min(1),
  categoryFit: z.record(z.string(), z.number().min(0).max(20)),
  categoryAliases: z.record(z.string(), z.string()),
  defaultFitKey: z.string().min(1),
  unknownCategoryFit: z.number().min(0).max(20),
  highConfidenceThreshold: z.number().min(0).max(1),
});

export const SETTING_KEYS = {
  scoring: 'scoring',
  dataSourceTests: 'data_source_tests',
} as const;

export async function getSetting<T>(key: string): Promise<T | null> {
  const db = getDb();
  const rows = await db.select().from(settings).where(eq(settings.key, key)).limit(1);
  return (rows[0]?.value as T) ?? null;
}

export async function putSetting(key: string, value: unknown): Promise<void> {
  const db = getDb();
  await db
    .insert(settings)
    .values({ key, value: value as object })
    .onConflictDoUpdate({ target: settings.key, set: { value: value as object, updatedAt: new Date() } });
}

/** Effective scoring config (DB value merged over code defaults). */
export async function getScoringConfig(): Promise<ScoringConfig> {
  const stored = await getSetting<Partial<ScoringConfig>>(SETTING_KEYS.scoring);
  if (!stored) return DEFAULT_SCORING_CONFIG;
  const merged: ScoringConfig = {
    ...DEFAULT_SCORING_CONFIG,
    ...stored,
    categoryFit: { ...DEFAULT_SCORING_CONFIG.categoryFit, ...(stored.categoryFit ?? {}) },
    categoryAliases: { ...DEFAULT_SCORING_CONFIG.categoryAliases, ...(stored.categoryAliases ?? {}) },
  };
  const check = scoringConfigSchema.safeParse(merged);
  return check.success ? merged : DEFAULT_SCORING_CONFIG;
}

export async function saveScoringConfig(config: ScoringConfig): Promise<void> {
  const parsed = scoringConfigSchema.parse(config);
  await putSetting(SETTING_KEYS.scoring, parsed);
}
