#!/usr/bin/env node
/**
 * Manages the embedded development Postgres cluster (no system install needed).
 *
 *   node server/scripts/db.mjs start|stop|status|reset
 *
 * The cluster lives in <repo>/.localdb/pgdata and listens on EMBEDDED_PG_PORT
 * (default 5433). Set DEVZARD_EMBEDDED_DB=false to manage your own Postgres.
 */
import EmbeddedPostgres from 'embedded-postgres';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(scriptDir, '..');
const repoRoot = path.resolve(serverRoot, '..');

dotenv.config({ path: path.join(repoRoot, '.env') });
dotenv.config({ path: path.join(repoRoot, '.env.local'), override: true });

const enabled = (process.env.DEVZARD_EMBEDDED_DB ?? 'true') !== 'false';
const dataDir = path.resolve(repoRoot, process.env.EMBEDDED_PG_DIR || '.localdb/pgdata');
const port = Number(process.env.EMBEDDED_PG_PORT || 5433);
const user = process.env.EMBEDDED_PG_USER || 'devzard';
const password = process.env.EMBEDDED_PG_PASSWORD || 'devzard';
const database = process.env.EMBEDDED_PG_DATABASE || 'devzard';

function portInUse(p) {
  return new Promise((resolve) => {
    const socket = net.connect({ port: p, host: '127.0.0.1', timeout: 700 });
    socket.on('connect', () => { socket.destroy(); resolve(true); });
    socket.on('error', () => resolve(false));
    socket.on('timeout', () => { socket.destroy(); resolve(false); });
  });
}

function makePg() {
  // The container image only ships C/POSIX locales; embedded-postgres
  // hardcodes --lc-messages=en_US.UTF-8, so override it on Linux.
  // (--locale is initdb-only; postgres accepts only the lc_messages GUC.)
  const isLinux = process.platform === 'linux';
  return new EmbeddedPostgres({
    databaseDir: dataDir,
    user,
    password,
    port,
    persistent: true,
    initdbFlags: isLinux ? ['--lc-messages=C.utf8', '--locale=C.utf8'] : [],
    postgresFlags: isLinux ? ['--lc-messages=C.utf8'] : [],
  });
}

async function waitForPort(p, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await portInUse(p)) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

async function start() {
  if (!enabled) {
    console.log('[db] DEVZARD_EMBEDDED_DB=false — using external DATABASE_URL');
    return;
  }
  if (await portInUse(port)) {
    console.log(`[db] Postgres already listening on port ${port} — nothing to do`);
    return;
  }
  const pg = makePg();
  if (!fs.existsSync(path.join(dataDir, 'PG_VERSION'))) {
    console.log(`[db] Initialising cluster in ${dataDir} ...`);
    await pg.initialise();
  }
  console.log(`[db] Starting Postgres on port ${port} ...`);
  await pg.start();
  if (!(await waitForPort(port))) throw new Error('Postgres did not start in time');
  try {
    await pg.createDatabase(database);
    console.log(`[db] Database "${database}" ready`);
  } catch {
    // already exists — fine
  }
  console.log('[db] Ready. Keeping this process alive as the database parent (Ctrl+C to stop).');
  // The library kills its children on exit, so this process must stay alive
  // for as long as the database should run. `npm run dev` and `db:start` keep
  // it as a child process; SIGTERM/SIGINT stop Postgres gracefully.
  const shutdown = () => {
    console.log('[db] Shutting down Postgres...');
    pg.stop()
      .catch(() => {})
      .finally(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  setInterval(() => {}, 1 << 30); // stay alive
}

async function stop() {
  if (!(await portInUse(port))) {
    console.log('[db] Not running');
    return;
  }
  const pg = makePg();
  try {
    await pg.stop();
    console.log('[db] Stopped');
  } catch (err) {
    console.error('[db] Stop failed:', err.message);
    process.exitCode = 1;
  }
}

async function status() {
  const running = await portInUse(port);
  console.log(running ? `[db] Running on port ${port}` : '[db] Not running');
  process.exitCode = running ? 0 : 1;
}

async function reset() {
  if (await portInUse(port)) await stop();
  if (fs.existsSync(dataDir)) {
    fs.rmSync(dataDir, { recursive: true, force: true });
    console.log('[db] Data directory removed');
  }
}

const cmd = process.argv[2];
const commands = { start, stop, status, reset };
if (!commands[cmd]) {
  console.error('Usage: node server/scripts/db.mjs start|stop|status|reset');
  process.exit(2);
}
commands[cmd]().catch((err) => {
  console.error('[db] Error:', err);
  process.exit(1);
});
