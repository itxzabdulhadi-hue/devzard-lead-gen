#!/usr/bin/env node
/**
 * One-command development orchestration:
 *   npm run dev
 *
 * Starts (in order):
 *   1. Embedded Postgres (unless DEVZARD_EMBEDDED_DB=false)
 *   2. Drizzle migrations + seed (idempotent)
 *   3. Demo-sites server (fake business websites for offline analyzer testing)
 *   4. API server + analysis worker (tsx watch)
 *   5. Vite dev server for the frontend
 */
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(scriptDir, '..');
const repoRoot = path.resolve(serverRoot, '..');

dotenv.config({ path: path.join(repoRoot, '.env') });
dotenv.config({ path: path.join(repoRoot, '.env.local'), override: true });

const children = [];
let shuttingDown = false;

const COLORS = { db: '\x1b[36m', demo: '\x1b[35m', api: '\x1b[33m', worker: '\x1b[32m', web: '\x1b[94m', setup: '\x1b[90m' };
const LABELS = { db: 'db     ', demo: 'demo   ', api: 'api    ', worker: 'worker ', web: 'web    ', setup: 'setup  ' };

function run(name, command, args, opts = {}) {
  const child = spawn(command, args, {
    cwd: opts.cwd || repoRoot,
    env: { ...process.env, ...opts.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const tag = `${COLORS[name] || ''}[${LABELS[name] || name}]\x1b[0m`;
  const forward = (buf) => {
    for (const line of buf.toString().split('\n')) {
      if (line.trim()) console.log(`${tag} ${line}`);
    }
  };
  child.stdout.on('data', forward);
  child.stderr.on('data', forward);
  child.on('exit', (code) => {
    if (!opts.keepQuiet && !shuttingDown) {
      console.log(`${tag} exited with code ${code}`);
    }
  });
  children.push(child);
  return child;
}

function waitForPort(port, host = '127.0.0.1', timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tryConnect = () => {
      const socket = net.connect({ port, host, timeout: 800 });
      socket.on('connect', () => { socket.destroy(); resolve(); });
      socket.on('error', () => {
        socket.destroy();
        if (Date.now() - started > timeoutMs) reject(new Error(`port ${port} not reachable in time`));
        else setTimeout(tryConnect, 400);
      });
      socket.on('timeout', () => { socket.destroy(); setTimeout(tryConnect, 400); });
    };
    tryConnect();
  });
}

function runSync(name, command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: cwd || repoRoot, stdio: 'inherit' });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${name} failed with code ${code}`))));
  });
}

async function main() {
  console.log('\x1b[1mDevzard Lead Generator — dev environment\x1b[0m');

  const embedded = (process.env.DEVZARD_EMBEDDED_DB ?? 'true') !== 'false';
  if (embedded) {
    run('db', 'node', [path.join(serverRoot, 'scripts/db.mjs'), 'start'], { keepQuiet: false });
    const pgPort = Number(process.env.EMBEDDED_PG_PORT || 5433);
    await waitForPort(pgPort);
    console.log('\x1b[90mPostgres is up\x1b[0m');
  }

  // Migrations + seed are idempotent and safe to run on every boot.
  await runSync('migrate', 'npx', ['drizzle-kit', 'migrate'], serverRoot);
  await runSync('seed', 'npm', ['run', 'db:seed', '--silent'], serverRoot);

  const demoPort = Number(process.env.DEMO_SITES_PORT || 4573);
  run('demo', 'node', [path.join(serverRoot, 'scripts/demo-sites.mjs')]);

  run('api', 'npx', ['tsx', 'watch', 'src/index.ts'], { cwd: serverRoot });
  run('worker', 'npx', ['tsx', 'watch', 'src/worker.ts'], { cwd: serverRoot });
  await waitForPort(Number(process.env.PORT || 4000));
  run('web', 'npm', ['run', 'dev', '--silent'], { cwd: path.resolve(repoRoot, 'web') });

  console.log('\x1b[1m\x1b[32m\n  ➜ Devzard Lead Generator ready:\x1b[0m');
  console.log(`\x1b[1m     Frontend:  http://localhost:5173\x1b[0m`);
  console.log(`     API:       http://localhost:${process.env.PORT || 4000}/api`);
  console.log(`     Demo user: ${process.env.DEVZARD_ADMIN_EMAIL || 'admin@devzard.internal'}\n`);
}

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('\nShutting down dev environment...');
  for (const child of children) {
    try { child.kill('SIGTERM'); } catch { /* noop */ }
  }
  setTimeout(() => process.exit(0), 800);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

main().catch((err) => {
  console.error('Dev environment failed:', err);
  shutdown();
  process.exit(1);
});
