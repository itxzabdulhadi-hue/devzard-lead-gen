import rateLimit from 'express-rate-limit';
import { env, IS_TEST } from '../config.js';

const skip = () => IS_TEST;

export const apiLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.RATE_LIMIT_MAX_API,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip,
  message: { ok: false, error: { message: 'Too many requests, please slow down.', code: 'rate_limited' } },
});

export const authLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: env.RATE_LIMIT_MAX_AUTH,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip,
  message: { ok: false, error: { message: 'Too many login attempts. Try again later.', code: 'rate_limited' } },
});

export const discoveryLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: 60,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip,
  message: { ok: false, error: { message: 'Too many discovery requests, please wait a moment.', code: 'rate_limited' } },
});
