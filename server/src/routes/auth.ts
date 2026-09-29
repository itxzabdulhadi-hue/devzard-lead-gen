import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { users } from '../db/schema.js';
import { ApiError } from '../middleware/errors.js';
import {
  clearSessionCookie,
  requireAuth,
  setSessionCookie,
  signSession,
  type SessionUser,
} from '../middleware/auth.js';
import { authLimiter } from '../middleware/rateLimit.js';

const router = Router();

const loginSchema = z.object({
  email: z.string().trim().email().max(200),
  password: z.string().min(1).max(200),
});

router.post('/login', authLimiter, async (req, res) => {
  const body = loginSchema.parse(req.body);
  const db = getDb();
  const rows = await db.select().from(users).where(eq(users.email, body.email.toLowerCase())).limit(1);
  const user = rows[0];
  // Constant-ish time: run a bcrypt compare even when the user doesn't exist.
  const hash = user?.passwordHash ?? '$2a$10$C6UzMDM.H6dfI/f/IKcEeO7ZBpFqzMz8fjR0v0Qz1f0E5Q9XG1VYe';
  const valid = await bcrypt.compare(body.password, hash);
  if (!user || !valid || !user.isActive) {
    throw new ApiError(401, 'Invalid email or password.', 'invalid_credentials');
  }
  const session: SessionUser = {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
  };
  setSessionCookie(res, signSession(session));
  res.json({ ok: true, data: { user: session } });
});

router.post('/logout', requireAuth, (req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true, data: { loggedOut: true } });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ ok: true, data: { user: req.user } });
});

export default router;
