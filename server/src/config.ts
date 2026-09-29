import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';


// Repository root, robust under tsx (src/config.ts), tsc build (dist/config.js)
// and vitest — derived from this module's location, never from argv/cwd.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

dotenv.config({ path: path.join(repoRoot, '.env') });
dotenv.config({ path: path.join(repoRoot, '.env.local'), override: true });

const num = (fallback: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v.trim() === '' ? fallback : Number(v)))
    .pipe(z.number().finite());

const bool = (fallback: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v.trim() === '' ? fallback : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())));

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: num(4000).pipe(z.number().int().positive()),
  WEB_ORIGIN: z.string().optional().default(''),
  JWT_SECRET: z.string().min(8).default('devzard-dev-secret-change-me'),
  JWT_EXPIRES_IN: z.string().default('24h'),
  DATABASE_URL: z
    .string()
    .default('postgresql://devzard:devzard@localhost:5433/devzard'),
  DEVZARD_ADMIN_EMAIL: z.string().email().optional(),
  DEVZARD_ADMIN_PASSWORD: z.string().min(8).optional(),
  OVERTURE_DATA_URL: z.string().optional().default(''),
  OVERTURE_MIN_CONFIDENCE: num(0.6).pipe(z.number().min(0).max(1)),
  FIXTURE_DATA_URL: z.string().optional().default(''),
  IMPORT_MAX_RECORDS: num(1000).pipe(z.number().int().min(1).max(100000)),
  ANALYSIS_CONCURRENCY: num(5).pipe(z.number().int().min(1).max(50)),
  ANALYSIS_TIMEOUT_MS: num(10000).pipe(z.number().int().min(1000).max(120000)),
  ANALYSIS_DELAY_MS: num(250).pipe(z.number().int().min(0).max(60000)),
  ANALYSIS_PER_HOST_DELAY_MS: num(1000).pipe(z.number().int().min(0).max(60000)),
  ANALYSIS_MAX_RETRIES: num(1).pipe(z.number().int().min(0).max(5)),
  ANALYSIS_MAX_BATCH: num(2000).pipe(z.number().int().min(1).max(50000)),
  ANALYSIS_MAX_RESPONSE_BYTES: num(2_000_000).pipe(z.number().int().min(10000)),
  ANALYSIS_ALLOW_PRIVATE_HOSTS: bool(false),
  DEMO_SITES_PORT: num(4573).pipe(z.number().int()),
  RATE_LIMIT_WINDOW_MS: num(5 * 60_000).pipe(z.number().int().positive()),
  RATE_LIMIT_MAX_API: num(1000).pipe(z.number().int().positive()),
  RATE_LIMIT_MAX_AUTH: num(10).pipe(z.number().int().positive()),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  throw new Error('Invalid environment configuration — check .env against .env.example');
}

export const env = parsed.data;

export const IS_TEST = env.NODE_ENV === 'test';
export const IS_PROD = env.NODE_ENV === 'production';

/** Absolute path of the repository root (useful for fixture resolution). */
export const REPO_ROOT = repoRoot;

/** Overture places parquet file URL derived from OVERTURE_DATA_URL. */
export function overturePlacesUrl(): string | null {
  if (!env.OVERTURE_DATA_URL) return null;
  const base = env.OVERTURE_DATA_URL.trim();
  if (!base) return null;
  if (/\.parquet(\?.*)?$/i.test(base)) return base;
  return base.endsWith('/') ? `${base}THEMES/places.parquet` : `${base}/THEMES/places.parquet`;
}

export function fixturePlacesPath(): string {
  if (env.FIXTURE_DATA_URL) return path.resolve(env.FIXTURE_DATA_URL);
  return path.join(repoRoot, 'fixtures', 'places-fixture.parquet');
}

export interface AnalysisConfig {
  concurrency: number;
  timeoutMs: number;
  delayMs: number;
  perHostDelayMs: number;
  maxRetries: number;
  maxBatch: number;
  maxResponseBytes: number;
  allowPrivateHosts: boolean;
}

export function analysisConfig(): AnalysisConfig {
  return {
    concurrency: env.ANALYSIS_CONCURRENCY,
    timeoutMs: env.ANALYSIS_TIMEOUT_MS,
    delayMs: env.ANALYSIS_DELAY_MS,
    perHostDelayMs: env.ANALYSIS_PER_HOST_DELAY_MS,
    maxRetries: env.ANALYSIS_MAX_RETRIES,
    maxBatch: env.ANALYSIS_MAX_BATCH,
    maxResponseBytes: env.ANALYSIS_MAX_RESPONSE_BYTES,
    allowPrivateHosts: env.ANALYSIS_ALLOW_PRIVATE_HOSTS,
  };
}
