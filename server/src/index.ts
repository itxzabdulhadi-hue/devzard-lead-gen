import { createApp } from './app.js';
import { env } from './config.js';
import { getPool } from './db/client.js';

async function main(): Promise<void> {
  // Fail fast if the database is unreachable.
  const pool = getPool();
  await pool.query('SELECT 1');

  const app = createApp();
  const server = app.listen(env.PORT, '0.0.0.0', () => {
    // eslint-disable-next-line no-console
    console.log(`[api] Devzard Lead Generator API listening on http://0.0.0.0:${env.PORT} (${env.NODE_ENV})`);
  });

  const shutdown = async () => {
    server.close();
    await pool.end().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[api] failed to start:', err.message);
  process.exit(1);
});
