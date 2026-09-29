import { ZodError } from 'zod';
import type { NextFunction, Request, Response } from 'express';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code = 'error',
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ ok: false, error: { message: 'Not found', code: 'not_found' } });
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (res.headersSent) return;

  if (err instanceof ApiError) {
    res.status(err.status).json({
      ok: false,
      error: { message: err.message, code: err.code, ...(err.details ? { details: err.details } : {}) },
    });
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({
      ok: false,
      error: {
        message: 'Validation failed',
        code: 'validation_error',
        details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
    });
    return;
  }

  // Unexpected errors: log internally, return a clean message (never leak stack).
  // eslint-disable-next-line no-console
  console.error('[api] unhandled error:', err);
  res.status(500).json({
    ok: false,
    error: { message: 'Something went wrong. Please try again.', code: 'internal_error' },
  });
}
