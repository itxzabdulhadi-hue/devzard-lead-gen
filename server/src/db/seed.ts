/**
 * Idempotent database seed: creates the admin (+ optional demo member) user
 * and ensures a default scoring configuration exists.
 *
 * Admin credentials come from DEVZARD_ADMIN_EMAIL / DEVZARD_ADMIN_PASSWORD.
 * CHANGE THE PASSWORD for any shared or production deployment.
 */
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { getDb, closeDb } from './client.js';
import { settings, users } from './schema.js';
import { getScoringConfig, putSetting, SETTING_KEYS } from './settings.js';
import { env } from '../config.js';

async function ensureUser(email: string, password: string, name: string, role: 'admin' | 'member') {
  const db = getDb();
  const existing = await db.select().from(users).where(eq(users.email, email.toLowerCase())).limit(1);
  if (existing[0]) {
    // eslint-disable-next-line no-console
    console.log(`[seed] user ${email} already exists (${existing[0].role})`);
    return existing[0].id;
  }
  const passwordHash = await bcrypt.hash(password, 10);
  const inserted = await db
    .insert(users)
    .values({ email: email.toLowerCase(), passwordHash, name, role })
    .returning({ id: users.id });
  // eslint-disable-next-line no-console
  console.log(`[seed] created ${role} user: ${email}`);
  return inserted[0]!.id;
}

async function main() {
  const adminEmail = env.DEVZARD_ADMIN_EMAIL ?? 'admin@devzard.internal';
  const adminPassword = env.DEVZARD_ADMIN_PASSWORD ?? 'devzard-admin';
  await ensureUser(adminEmail, adminPassword, 'Devzard Admin', 'admin');
  if (!env.DEVZARD_ADMIN_EMAIL) {
    await ensureUser('sara@devzard.internal', 'devzard-member', 'Sara Haddad', 'member');
  }

  // Ensure the scoring configuration row exists (defaults come from code).
  const config = await getScoringConfig();
  const stored = await getDb().select().from(settings);
  if (!stored.some((s) => s.key === SETTING_KEYS.scoring)) {
    await putSetting(SETTING_KEYS.scoring, config);
    // eslint-disable-next-line no-console
    console.log(`[seed] stored default scoring config (${config.version})`);
  }

  await closeDb();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[seed] failed:', err);
  process.exit(1);
});
