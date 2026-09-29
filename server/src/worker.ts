import { runWorkerLoop } from './worker/analysisWorker.js';

async function main(): Promise<void> {
  const handle = await runWorkerLoop();
  const shutdown = () => {
    handle
      .stop()
      .catch(() => {})
      .finally(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[worker] failed to start:', err.message);
  process.exit(1);
});
