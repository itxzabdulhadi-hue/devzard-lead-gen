/**
 * Vitest global setup: ensure the `devzard_test` database exists and apply
 * the committed Drizzle migration SQL directly with node-postgres.
 *
 * (Deliberately NOT using drizzle-kit/migrator here: the migrator's module
 * loader hooks break vitest's global-setup worker.)
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

export default async function globalSetup(): Promise<void> {
  const { Pool, Client } = require('pg') as typeof import('pg');

  const admin = new Pool({ connectionString: 'postgresql://devzard:devzard@localhost:5433/postgres' });
  await admin.query('SELECT 1'); // fail fast when the dev DB isn't running
  const exists = await admin.query(`SELECT 1 FROM pg_database WHERE datname = 'devzard_test'`);
  if (exists.rowCount === 0) {
    await admin.query('CREATE DATABASE devzard_test');
  }
  await admin.end();

  const here = path.dirname(fileURLToPath(import.meta.url));
  const migrationsDir = path.resolve(here, '../../drizzle');

  const client = new Client({ connectionString: 'postgresql://devzard:devzard@localhost:5433/devzard_test' });
  await client.connect();
  try {
    // Fresh schema on every test run.
    await client.query(`
      DROP TABLE IF EXISTS website_analysis, lead_scores, leads, analysis_jobs, settings, businesses, users CASCADE;
      DROP TYPE IF EXISTS user_role, lead_status, analysis_job_status CASCADE;
    `);

    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    for (const file of files) {
      const sqlText = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      for (const statement of sqlText.split('--> statement-breakpoint')) {
        const trimmed = statement.trim();
        if (trimmed) await client.query(trimmed);
      }
    }
  } finally {
    await client.end();
  }
}
