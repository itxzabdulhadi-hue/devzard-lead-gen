/**
 * API integration tests — run against a real Postgres (devzard_test) over
 * real HTTP. Covers: auth, lead CRUD + filters, discovery import + dedupe,
 * website analysis persistence, scoring, worker flow, CSV export,
 * SQL-injection safety, role authorization.
 */
import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  createUser,
  del,
  get,
  loginAs,
  patch,
  post,
  put,
  truncateAll,
  type TestUser,
} from './helpers.js';
import { getDb } from '../db/client.js';
import { businesses } from '../db/schema.js';
import { computeScore, DEFAULT_SCORING_CONFIG } from '../lib/scoring.js';

let admin: TestUser;
let member: TestUser;
let adminCookie: string;
let memberCookie: string;

beforeAll(async () => {
  admin = await createUser('admin');
  member = await createUser('member');
  adminCookie = await loginAs(admin.email);
  memberCookie = await loginAs(member.email);
});

afterAll(async () => {
  await truncateAll();
});

/* ── Auth & authorization ────────────────────────────────────────────────── */

describe('authentication', () => {
  it('rejects wrong credentials', async () => {
    const res = await post('/api/auth/login', { email: admin.email, password: 'wrong-password' });
    expect(res.status).toBe(401);
    expect((res.body as { error: { code: string } }).error.code).toBe('invalid_credentials');
  });

  it('rejects malformed payloads', async () => {
    const res = await post('/api/auth/login', { email: 'not-an-email', password: '' });
    expect(res.status).toBe(400);
    expect((res.body as { error: { code: string } }).error.code).toBe('validation_error');
  });

  it('returns 401 for unauthenticated API access', async () => {
    expect((await get('/api/leads')).status).toBe(401);
    expect((await get('/api/leads/export')).status).toBe(401);
    expect((await get('/api/dashboard/stats')).status).toBe(401);
    expect((await post('/api/leads/bulk-analyze', { businessIds: [] })).status).toBe(401);
  });

  it('logs in with a session cookie and reports the user', async () => {
    const res = await get('/api/auth/me', adminCookie);
    expect(res.status).toBe(200);
    const user = (res.body as { data: { user: { email: string; role: string } } }).data.user;
    expect(user.email).toBe(admin.email);
    expect(user.role).toBe('admin');
  });
});

/* ── Discovery → import → dedupe ─────────────────────────────────────────── */

describe('discovery and import (fixture provider)', () => {
  it('requires at least one filter', async () => {
    const res = await post('/api/leads/search', { limit: 10 }, adminCookie);
    expect(res.status).toBe(400);
    expect((res.body as { error: { code: string } }).error.code).toBe('no_filters');
  });

  it('searches the fixture dataset (Dubai restaurants)', async () => {
    const res = await post(
      '/api/leads/search',
      { provider: 'fixture', country: 'United Arab Emirates', city: 'Dubai', category: 'restaurant', limit: 100 },
      adminCookie,
    );
    expect(res.status).toBe(200);
    const d = (res.body as { data: { discovered: number; preview: unknown[] } }).data;
    expect(d.discovered).toBeGreaterThan(0);
    expect(d.preview.length).toBeGreaterThan(0);
  });

  it('validates search input', async () => {
    const res = await post('/api/leads/search', { provider: 'fixture', city: 'Dubai', limit: -5 }, adminCookie);
    expect(res.status).toBe(400);
    const res2 = await post('/api/leads/search', { provider: 'nope', city: 'Dubai' }, adminCookie);
    expect(res2.status).toBe(400);
  });

  it('imports records and reports counts', async () => {
    const res = await post(
      '/api/leads/import',
      { provider: 'fixture', country: 'AE', city: 'Dubai', category: 'restaurant', limit: 50 },
      adminCookie,
    );
    expect(res.status).toBe(200);
    const d = (
      res.body as {
        data: { discovered: number; imported: number; alreadyExisting: number; businessIds: string[] };
      }
    ).data;
    expect(d.discovered).toBeGreaterThan(0);
    expect(d.imported).toBe(d.discovered);
    expect(d.alreadyExisting).toBe(0);
    expect(d.businessIds.length).toBe(d.imported);
  });

  it('deduplicates on re-import (same source ids)', async () => {
    const res = await post(
      '/api/leads/import',
      { provider: 'fixture', country: 'AE', city: 'Dubai', category: 'restaurant', limit: 50 },
      adminCookie,
    );
    expect(res.status).toBe(200);
    const d = (
      res.body as { data: { imported: number; alreadyExisting: number; discovered: number } }
    ).data;
    expect(d.imported).toBe(0);
    expect(d.alreadyExisting).toBe(d.discovered);
  });

  it('normalizes records (phones, websites, domains, socials)', async () => {
    const db = getDb();
    const rows = await db.select().from(businesses).limit(50);
    expect(rows.length).toBeGreaterThan(0);
    for (const b of rows) {
      if (b.phone) {
        expect(b.phone.startsWith('+')).toBe(true);
        expect(/^\+\d{7,15}$/.test(b.phone)).toBe(true);
      }
      if (b.website) {
        expect(b.website).toMatch(/^https?:\/\//);
        expect(b.websiteDomain).toBeTruthy();
      }
      expect(b.country).toBe('AE');
    }
  });
});

/* ── Lead list, filters, pagination ──────────────────────────────────────── */

describe('lead list', () => {
  it('paginates server-side', async () => {
    const p1 = await get('/api/leads?page=1&pageSize=2', adminCookie);
    expect(p1.status).toBe(200);
    const d1 = p1.body as { data: unknown[]; pagination: { total: number; totalPages: number } };
    expect(d1.data.length).toBeLessThanOrEqual(2);
    expect(d1.pagination.total).toBeGreaterThan(0);
    expect(d1.pagination.totalPages).toBeGreaterThan(1);

    const p2 = await get('/api/leads?page=2&pageSize=2', adminCookie);
    const d2 = p2.body as { data: Array<{ id: string }> };
    expect(d2.data[0]!.id).not.toBe((d1.data[0] as { id: string }).id);
  });

  it('filters by score, website and social', async () => {
    const high = await get('/api/leads?minScore=80', adminCookie);
    for (const row of (high.body as { data: Array<{ score: number }> }).data) {
      expect(row.score).toBeGreaterThanOrEqual(80);
    }

    const noSite = await get('/api/leads?website=none', adminCookie);
    for (const row of (noSite.body as { data: Array<{ website: string | null }> }).data) {
      expect(row.website).toBeNull();
    }

    const socialOnly = await get('/api/leads?social=social_no_website', adminCookie);
    for (const row of (high.body as { data: Array<{ score: number }> }).data) {
      expect(row.score).toBeGreaterThanOrEqual(80);
    }
    for (const row of (socialOnly.body as {
      data: Array<{ website: string | null; instagram: string | null; facebook: string | null; linkedin: string | null }>;
    }).data) {
      expect(row.website).toBeNull();
      expect(row.instagram || row.facebook || row.linkedin).toBeTruthy();
    }
  });

  it('sorts by score with nulls last', async () => {
    const res = await get('/api/leads?sort=score&dir=desc&pageSize=50', adminCookie);
    const scores = (res.body as { data: Array<{ score: number | null }> }).data.map((r) => r.score ?? -1);
    const sorted = [...scores].sort((a, b) => b - a);
    expect(scores).toEqual(sorted);
  });

  it('is safe against SQL injection attempts', async () => {
    const sneaky = await get("/api/leads?q='; DROP TABLE businesses;--", adminCookie);
    expect(sneaky.status).toBe(200);

    const sortInjection = await get('/api/leads?sort=(SELECT 1)', adminCookie);
    expect(sortInjection.status).toBe(400);

    const statusInjection = await get('/api/leads?status=new%27%3B--', adminCookie);
    expect(statusInjection.status).toBe(400);

    const statusArrayInjection = await get('/api/leads?status=new,reviewing', adminCookie);
    expect(statusArrayInjection.status).toBe(200);

    // businesses table still exists and works
    const still = await get('/api/leads?pageSize=1', adminCookie);
    expect(still.status).toBe(200);
    expect((still.body as { pagination: { total: number } }).pagination.total).toBeGreaterThan(0);
  });

  it('rejects invalid uuid ids', async () => {
    const res = await get('/api/leads/not-a-uuid', adminCookie);
    expect(res.status).toBe(400);
  });
});

/* ── CRM updates + roles ─────────────────────────────────────────────────── */

describe('CRM updates', () => {
  let leadId: string;

  beforeAll(async () => {
    const res = await get('/api/leads?pageSize=1', adminCookie);
    leadId = (res.body as { data: Array<{ id: string }> }).data[0]!.id;
  });

  it('updates status, notes, tags and follow-up', async () => {
    const res = await patch(
      `/api/leads/${leadId}`,
      {
        status: 'qualified',
        notes: 'Wants an online ordering demo',
        tags: ['hot', 'ordering'],
        followUpAt: '2026-10-15T00:00:00.000Z',
      },
      adminCookie,
    );
    expect(res.status).toBe(200);
    const lead = (res.body as { data: { lead: { status: string; tags: string[] } } }).data.lead;
    expect(lead.status).toBe('qualified');
    expect(lead.tags).toEqual(['hot', 'ordering']);

    const detail = await get(`/api/leads/${leadId}`, adminCookie);
    expect(
      (detail.body as { data: { lead: { notes: string | null } } }).data.lead.notes,
    ).toBe('Wants an online ordering demo');
  });

  it('stamps contactedAt when moving to contacted', async () => {
    const res = await patch(`/api/leads/${leadId}`, { status: 'contacted' }, adminCookie);
    const lead = (res.body as { data: { lead: { contactedAt: string | null } } }).data.lead;
    expect(lead.contactedAt).toBeTruthy();
  });

  it('assigns to an existing user and rejects unknown users', async () => {
    const ok = await patch(`/api/leads/${leadId}`, { assignedTo: member.id }, adminCookie);
    expect((ok.body as { data: { lead: { assignedTo: string | null } } }).data.lead.assignedTo).toBe(
      member.id,
    );

    const bad = await patch(
      `/api/leads/${leadId}`,
      { assignedTo: '00000000-0000-0000-0000-000000000000' },
      adminCookie,
    );
    expect(bad.status).toBe(400);
  });

  it('blocks invalid statuses and payloads', async () => {
    const res = await patch(`/api/leads/${leadId}`, { status: 'maybe' }, adminCookie);
    expect(res.status).toBe(400);
    const empty = await patch(`/api/leads/${leadId}`, {}, adminCookie);
    expect(empty.status).toBe(400);
  });

  it('members can manage leads but not delete them', async () => {
    const ok = await patch(`/api/leads/${leadId}`, { notes: 'member note' }, memberCookie);
    expect(ok.status).toBe(200);

    const delRes = await del(`/api/leads/${leadId}`, memberCookie);
    expect(delRes.status).toBe(403);
  });

  it('admin can delete a lead (cascade)', async () => {
    const delRes = await del(`/api/leads/${leadId}`, adminCookie);
    expect(delRes.status).toBe(200);
    const gone = await get(`/api/leads/${leadId}`, adminCookie);
    expect(gone.status).toBe(404);
  });

  it('members cannot change scoring config', async () => {
    const res = await put('/api/settings/scoring', { categoryFit: { restaurant: 5 } }, memberCookie);
    expect(res.status).toBe(403);
  });
});

/* ── Website analysis (real HTTP against a local audit target) ───────────── */

function startAuditTarget(): Promise<{ server: http.Server; port: number; urlFor: (slug: string) => string }> {
  return new Promise((resolve) => {
    const pages: Record<string, [number, string, string]> = {
      '/good': [
        200,
        'text/html',
        '<html><head><title>Good Site</title><meta name="description" content="Fine"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="canonical" href="/good"><script type="application/ld+json">{"@type":"LocalBusiness"}</script></head><body><h1>Hello</h1><a href="tel:+97141234567">Call</a><a class="btn" href="/good/book">Book now</a></body></html>',
      ],
      '/poor': [200, 'text/html', '<html><head><title>   </title></head><body><p>plain</p></body></html>'],
      '/hidden': [200, 'text/html', '<html><head><title>Hidden</title></head><body>robots-disallowed</body></html>'],
      '/robots.txt': [200, 'text/plain', 'User-agent: *\nDisallow: /hidden\nSitemap: /sitemap.xml'],
      '/sitemap.xml': [200, 'application/xml', '<urlset><url><loc>/good</loc></url></urlset>'],
    };
    const server = http.createServer((req, res) => {
      const entry = pages[new URL(req.url ?? '/', 'http://x').pathname];
      if (!entry) {
        res.writeHead(404, { 'content-type': 'text/html' });
        res.end('404');
        return;
      }
      res.writeHead(entry[0], { 'content-type': entry[1] });
      res.end(entry[2]);
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      resolve({ server, port: addr.port, urlFor: (slug: string) => `http://127.0.0.1:${addr.port}${slug}` });
    });
  });
}

describe('website analysis + scoring persistence', () => {
  let target: { server: http.Server; port: number; urlFor: (slug: string) => string };

  beforeAll(async () => {
    target = await startAuditTarget();
    // Import a fresh batch to work with.
    await post('/api/leads/import', { provider: 'fixture', country: 'SA', limit: 20 }, adminCookie);
  });

  afterAll(() => {
    target.server.close();
  });

  it('analyzes a good website and persists the audit + recalculated score', async () => {
    const db = getDb();
    const rows = await db.select().from(businesses).limit(1);
    const business = rows[0]!;
    await db
      .update(businesses)
      .set({ website: target.urlFor('/good'), websiteDomain: `127.0.0.1:${target.port}` })
      .where(eq(businesses.id, business.id));

    const res = await post(`/api/leads/${business.id}/analyze`, undefined, adminCookie);
    expect(res.status).toBe(200);
    const d = (res.body as { data: { analysis: Record<string, unknown>; score: { totalScore: number } } }).data;
    expect(d.analysis.reachable).toBe(true);
    expect(d.analysis.hasTitle).toBe(true);
    expect(d.analysis.hasMetaDescription).toBe(true);
    expect(d.analysis.hasH1).toBe(true);
    expect(d.analysis.mobileFriendly).toBe(true);
    expect(d.analysis.canonical).toBe(true);
    expect(d.analysis.structuredData).toBe(true);
    expect(d.analysis.robotsTxt).toBe(true);
    expect(d.analysis.sitemap).toBe(true);
    expect(d.analysis.hasContactInformation).toBe(true);
    expect(d.analysis.hasCta).toBe(true);
    expect(d.analysis.hasBooking).toBe(true);
    expect(d.analysis.error).toBeNull();

    // Score must equal the deterministic engine applied to the stored row
    const fresh = await db.select().from(businesses).where(eq(businesses.id, business.id)).limit(1);
    const b = fresh[0]!;
    const expected = computeScore(
      {
        name: b.name,
        website: b.website,
        phone: b.phone,
        email: b.email,
        instagram: b.instagram,
        facebook: b.facebook,
        linkedin: b.linkedin,
        category: b.category,
        country: b.country,
        city: b.city,
        address: b.address,
        sourceConfidence: b.sourceConfidence,
      },
      d.analysis as Parameters<typeof computeScore>[1],
      DEFAULT_SCORING_CONFIG,
    );
    expect(d.score.totalScore).toBe(expected.totalScore);
    // A healthy site should have no website-category penalty signals
    const penaltyTypes = ['no_website', 'unreachable', 'weak_seo', 'not_mobile'];
    const websitePenalties = expected.reasons.signals.filter(
      (sig) => sig.category === 'website' && penaltyTypes.includes(sig.type),
    );
    expect(websitePenalties).toHaveLength(0);
  });

  it('audits a poor website and produces the expected penalty signals', async () => {
    const db = getDb();
    const rows = await db.select().from(businesses).offset(1).limit(1);
    const business = rows[0]!;
    await db
      .update(businesses)
      .set({ website: target.urlFor('/poor'), websiteDomain: `poor-${Date.now()}.test` })
      .where(eq(businesses.id, business.id));

    const res = await post(`/api/leads/${business.id}/analyze`, undefined, adminCookie);
    expect(res.status).toBe(200);
    const d = (res.body as { data: { analysis: Record<string, unknown>; score: { totalScore: number; reasons: { signals: Array<{ type: string }> } } } }).data;
    expect(d.analysis.reachable).toBe(true);
    expect(d.analysis.hasTitle).toBe(false);
    expect(d.analysis.hasMetaDescription).toBe(false);
    expect(d.analysis.hasH1).toBe(false);
    expect(d.analysis.https).toBe(false);
    const types = d.score.reasons.signals.map((s) => s.type);
    expect(types).toContain('major_technical_issues');
    expect(d.score.totalScore).toBeGreaterThanOrEqual(60);
  });

  it('respects robots.txt during analysis', async () => {
    const db = getDb();
    const rows = await db.select().from(businesses).offset(2).limit(1);
    const business = rows[0]!;
    await db
      .update(businesses)
      .set({ website: target.urlFor('/hidden'), websiteDomain: `hidden-${Date.now()}.test` })
      .where(eq(businesses.id, business.id));
    const res = await post(`/api/leads/${business.id}/analyze`, undefined, adminCookie);
    expect(res.status).toBe(200);
    const d = (res.body as { data: { analysis: Record<string, unknown>; warning: string | null } }).data;
    expect(d.analysis.hasTitle).toBeNull();
    expect(d.warning).toMatch(/robots/i);
  });

  it('records unreachable sites with reachable=false and an error string', async () => {
    const db = getDb();
    const rows = await db.select().from(businesses).offset(3).limit(1);
    const business = rows[0]!;
    const deadDomain = `dead-${Date.now()}.example`;
    await db
      .update(businesses)
      .set({ website: `https://${deadDomain}`, websiteDomain: deadDomain })
      .where(eq(businesses.id, business.id));

    const res = await post(`/api/leads/${business.id}/analyze`, undefined, adminCookie);
    expect(res.status).toBe(200);
    const d = (res.body as {
      data: { analysis: { reachable: boolean; error: string | null }; score: { reasons: { signals: Array<{ type: string }> } } };
    }).data;
    expect(d.analysis.reachable).toBe(false);
    expect(d.analysis.error).toBeTruthy();
    const types = d.score.reasons.signals.map((s) => s.type);
    expect(types).toContain('website_unreachable');
  });

  it('handles businesses without websites (no_website signal)', async () => {
    const db = getDb();
    const rows = await db.select().from(businesses).offset(4).limit(1);
    const business = rows[0]!;
    await db
      .update(businesses)
      .set({ website: null, websiteDomain: null })
      .where(eq(businesses.id, business.id));

    const res = await post(`/api/leads/${business.id}/analyze`, undefined, adminCookie);
    // API answers 422 (nothing to fetch) but the score is recalculated
    expect(res.status).toBe(422);
    expect((res.body as { error: { code: string } }).error.code).toBe('no_website');

    const detail = await get(`/api/leads/${business.id}`, adminCookie);
    const data = (detail.body as {
      data: {
        score: { reasons: { signals: Array<{ type: string }> } } | null;
        analysis: unknown;
      };
    }).data;
    expect(data.score.reasons.signals.map((s) => s.type)).toContain('no_website');
    expect(data.analysis).toBeNull();
  });
});

/* ── Worker flow (bulk job → claim → process → progress) ─────────────────── */

describe('bulk analysis job flow', () => {
  it('creates a queued job and the worker logic processes it end-to-end', async () => {
    const list = await get('/api/leads?pageSize=5', adminCookie);
    const ids = (list.body as { data: Array<{ id: string }> }).data.map((r) => r.id);

    const created = await post('/api/leads/bulk-analyze', { businessIds: ids }, adminCookie);
    expect(created.status).toBe(202);
    const jobId = (created.body as { data: { jobId: string } }).data.jobId;

    let job = (
      (await get(`/api/analysis/jobs/${jobId}`, adminCookie)).body as { data: { job: { status: string; total: number } } }
    ).data.job;
    expect(job.status).toBe('queued');
    expect(job.total).toBe(ids.length);

    // Run the worker processing inline (production: separate worker process)
    const { claimNextJob, processJob } = await import('../worker/analysisWorker.js');
    const claimed = await claimNextJob();
    expect(claimed?.id).toBe(jobId);
    await processJob(claimed!, {
      concurrency: 3,
      timeoutMs: 5000,
      delayMs: 0,
      perHostDelayMs: 0,
      maxRetries: 0,
      maxBatch: 100,
      maxResponseBytes: 1_000_000,
      allowPrivateHosts: true,
    });

    job = (
      (await get(`/api/analysis/jobs/${jobId}`, adminCookie)).body as {
        data: { job: { status: string; completed: number; failed: number; total: number } };
      }
    ).data.job;
    expect(job.status).toBe('completed');
    expect(job.completed).toBe(job.total);
    expect(job.failed).toBe(0);

    const after = await get('/api/leads?pageSize=50&analyzed=yes', adminCookie);
    expect((after.body as { pagination: { total: number } }).pagination.total).toBeGreaterThan(0);
  });

  it('validates bulk payloads', async () => {
    const bad = await post('/api/leads/bulk-analyze', { businessIds: ['nope'] }, adminCookie);
    expect(bad.status).toBe(400);
    const empty = await post('/api/leads/bulk-analyze', { businessIds: [] }, adminCookie);
    expect(empty.status).toBe(400);
  });
});

/* ── CSV export ──────────────────────────────────────────────────────────── */

describe('CSV export', () => {
  it('exports filtered leads with the spec columns', async () => {
    const res = await get('/api/leads/export?country=AE', adminCookie);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    const lines = res.text.trim().split('\n');
    expect(lines[0]).toBe(
      'business_name,category,country,city,address,phone,email,website,instagram,facebook,linkedin,opportunity_score,website_status,score_reasons,lead_status',
    );
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines.slice(1)) {
      expect(line).not.toMatch(/(^|,)\+9\d/); // formula-injection-safe phone cells
    }
  });

  it('honors filters in exports', async () => {
    const all = await get('/api/leads/export', adminCookie);
    const filtered = await get('/api/leads/export?minScore=95', adminCookie);
    const countRows = (t: string) => Math.max(0, t.trim().split('\n').length - 1);
    expect(countRows(filtered.text)).toBeLessThanOrEqual(countRows(all.text));
  });
});

/* ── Dashboard + settings + data sources ─────────────────────────────────── */

describe('dashboard & settings', () => {
  it('returns dashboard stats computed from the database', async () => {
    const res = await get('/api/dashboard/stats', adminCookie);
    expect(res.status).toBe(200);
    const d = (
      res.body as {
        data: {
          totals: { businesses: number };
          pipeline: Record<string, number>;
          topCategories: unknown[];
          recentLeads: Array<{ id: string }>;
        };
      }
    ).data;
    expect(d.totals.businesses).toBeGreaterThan(0);
    expect(Object.values(d.pipeline).some((v) => v > 0)).toBe(true);
    expect(Array.isArray(d.topCategories)).toBe(true);
    if (d.recentLeads.length > 0) {
      const detail = await get(`/api/leads/${d.recentLeads[0]!.id}`, adminCookie);
      expect(detail.status).toBe(200);
    }
  });

  it('exposes data sources with configuration state', async () => {
    const res = await get('/api/data-sources', adminCookie);
    expect(res.status).toBe(200);
    const sources = (res.body as { data: { sources: Array<{ id: string; configured: boolean }> } }).data.sources;
    const ids = sources.map((s) => s.id);
    expect(ids).toContain('fixture');
    expect(ids).toContain('overture');
    expect(sources.find((s) => s.id === 'fixture')?.configured).toBe(true);
  });

  it('tests the fixture data source connection', async () => {
    const res = await post('/api/data-sources/fixture/test', undefined, adminCookie);
    expect(res.status).toBe(200);
    expect((res.body as { data: { ok: boolean } }).data.ok).toBe(true);
  });

  it('reads and updates scoring configuration (admin only)', async () => {
    const read = await get('/api/settings/scoring', adminCookie);
    expect(read.status).toBe(200);
    const config = (read.body as { data: { config: { categoryFit: Record<string, number> } } }).data.config;
    expect(config.categoryFit.restaurant).toBe(20);

    const memberWrite = await put('/api/settings/scoring', { categoryFit: { restaurant: 5 } }, memberCookie);
    expect(memberWrite.status).toBe(403);

    const write = await put('/api/settings/scoring', { categoryFit: { restaurant: 18 } }, adminCookie);
    expect(write.status).toBe(200);
    expect(
      (write.body as { data: { config: { categoryFit: Record<string, number> } } }).data.config.categoryFit.restaurant,
    ).toBe(18);

    await put('/api/settings/scoring', { categoryFit: { restaurant: 20 } }, adminCookie);
  });
});
