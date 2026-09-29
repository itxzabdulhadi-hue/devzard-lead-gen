import { Router } from 'express';
import { z } from 'zod';
import { requireAdmin, requireAuth } from '../middleware/auth.js';
import { ApiError } from '../middleware/errors.js';
import { providers } from '../services/discovery/index.js';
import { getSetting, SETTING_KEYS, putSetting } from '../db/settings.js';
import { discoveryLimiter } from '../middleware/rateLimit.js';
import { overturePlacesUrl, fixturePlacesPath } from '../config.js';

const router = Router();
router.use(requireAuth);

interface StoredTestResults {
  [providerId: string]: { ok: boolean; detail: string; testedAt: string };
}

async function storedTests(): Promise<StoredTestResults> {
  return (await getSetting<StoredTestResults>(SETTING_KEYS.dataSourceTests)) ?? {};
}

/** GET /api/data-sources — provider list + configuration + last test result. */
router.get('/', async (_req, res) => {
  const tests = await storedTests();
  const data = providers.map((p) => ({
    id: p.id,
    label: p.label,
    type: p.type,
    description: p.description,
    license: p.license,
    requiresInternet: p.requiresInternet,
    configured: p.isConfigured(),
    config: {
      overtureUrl: p.id === 'overture' ? overturePlacesUrl() : null,
      fixturePath: p.id === 'fixture' ? fixturePlacesPath() : null,
    },
    lastTest: tests[p.id] ?? null,
  }));
  res.json({ ok: true, data: { sources: data } });
});

/** POST /api/data-sources/:id/test — small live query against the source. */
router.post('/:id/test', discoveryLimiter, async (req, res) => {
  const id = z.string().trim().max(50).parse(req.params.id);
  const provider = providers.find((p) => p.id === id);
  if (!provider) throw new ApiError(404, 'Unknown data source.', 'not_found');
  const result = await provider.testConnection();
  const tests = await storedTests();
  tests[id] = result;
  await putSetting(SETTING_KEYS.dataSourceTests, tests);
  res.json({ ok: true, data: { providerId: id, ...result } });
});

/** PUT /api/data-sources/overture — set the release URL (admin). */
const updateOvertureSchema = z.object({
  releaseUrl: z
    .string()
    .trim()
    .max(500)
    .regex(/^https?:\/\/.+/i, 'Must be an http(s) URL'),
});

router.put('/overture', requireAdmin, async (req, res) => {
  const body = updateOvertureSchema.parse(req.body);
  // Stored in settings so ops can change the release without redeploying.
  // The provider prefers the env var when present.
  await putSetting('overture_release_url', { url: body.releaseUrl, updatedAt: new Date().toISOString() });
  res.json({
    ok: true,
    data: {
      saved: true,
      note: 'Stored. OVERTURE_DATA_URL environment variable takes precedence when set.',
    },
  });
});

export default router;
