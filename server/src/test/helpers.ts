import type { Express } from 'express';
import bcrypt from 'bcryptjs';
import { sql } from 'drizzle-orm';
import { createApp } from '../app.js';
import { getDb, closeDb } from '../db/client.js';
import { users } from '../db/schema.js';

/**
 * Test HTTP helpers — a real Express server on an ephemeral port, driven with
 * plain fetch (supertest's ESM interop is unreliable across bundlers).
 */
let sharedServer: { app: Express; origin: string; close: () => void } | null = null;

async function getOrigin(): Promise<string> {
  if (!sharedServer) {
    const app = createApp();
    const origin = await new Promise<string>((resolve) => {
      const server = app.listen(0, '127.0.0.1', () => {
        const addr = server.address() as { port: number };
        resolve(`http://127.0.0.1:${addr.port}`);
      });
    });
    sharedServer = { app, origin, close: () => void 0 };
    // keep a handle for teardown
    (sharedServer as { server?: unknown }).server = app.listen ? app : app;
  }
  return sharedServer.origin;
}

export interface TestResponse {
  status: number;
  headers: Headers;
  body: unknown;
  text: string;
  ok: boolean;
}

export async function request(
  method: string,
  path: string,
  options: { cookie?: string; body?: unknown } = {},
): Promise<TestResponse> {
  const origin = await getOrigin();
  const res = await fetch(`${origin}${path}`, {
    method,
    headers: {
      ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(options.cookie ? { cookie: options.cookie } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, headers: res.headers, body, text, ok: res.ok };
}

/** fluent-ish helpers used by tests */
export const get = (path: string, cookie?: string) => request('GET', path, { cookie });
export const post = (path: string, body?: unknown, cookie?: string) =>
  request('POST', path, { body, cookie });
export const patch = (path: string, body: unknown, cookie?: string) =>
  request('PATCH', path, { body, cookie });
export const put = (path: string, body: unknown, cookie?: string) =>
  request('PUT', path, { body, cookie });
export const del = (path: string, cookie?: string) => request('DELETE', path, { cookie });

export function expect(res: TestResponse, status: number): TestResponse {
  if (res.status !== status) {
    throw new Error(
      `Expected HTTP ${status}, got ${res.status}: ${JSON.stringify(res.body).slice(0, 300)}`,
    );
  }
  return res;
}

export interface TestUser {
  id: string;
  email: string;
  role: 'admin' | 'member';
}

let counter = 0;

export async function createUser(role: 'admin' | 'member'): Promise<TestUser> {
  const db = getDb();
  counter += 1;
  const email = `user-${counter}-${role}@devzard.test`;
  const passwordHash = await bcrypt.hash('password-123', 4);
  const rows = await db
    .insert(users)
    .values({ email, passwordHash, name: `Test ${role} ${counter}`, role })
    .returning({ id: users.id, email: users.email, role: users.role });
  return rows[0]!;
}

export async function loginAs(email: string, password = 'password-123'): Promise<string> {
  const res = await post('/api/auth/login', { email, password });
  if (res.status !== 200) {
    throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  const setCookie = res.headers.get('set-cookie');
  if (!setCookie) throw new Error('no session cookie returned');
  return setCookie.split(';')[0]!;
}

export async function truncateAll(): Promise<void> {
  const db = getDb();
  await db.execute(sql`
    TRUNCATE website_analysis, lead_scores, leads, analysis_jobs, settings, businesses, users CASCADE
  `);
}

export async function closeTestServer(): Promise<void> {
  shared?.close();
  shared = null;
  await closeDb();
}
