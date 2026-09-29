import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { env, IS_PROD } from './config.js';
import { apiLimiter } from './middleware/rateLimit.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';
import authRoutes from './routes/auth.js';
import leadRoutes from './routes/leads.js';
import discoveryRoutes from './routes/discovery.js';
import analysisRoutes from './routes/analysis.js';
import dashboardRoutes from './routes/dashboard.js';
import dataSourcesRoutes from './routes/dataSources.js';
import settingsRoutes from './routes/settings.js';

export function createApp(): express.Express {
  const app = express();

  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: false })); // API + SPA; CSP managed by Vite/index meta

  if (env.WEB_ORIGIN) {
    app.use(
      cors({
        origin: env.WEB_ORIGIN.split(',').map((o) => o.trim()),
        credentials: true,
      }),
    );
  }

  app.use(express.json({ limit: '256kb' }));

  app.get('/healthz', (_req, res) => {
    res.json({ ok: true, service: 'devzard-lead-gen', time: new Date().toISOString() });
  });

  const api = express.Router();
  api.use(apiLimiter);
  api.use('/auth', authRoutes);
  api.use('/leads', leadRoutes);
  api.use('/leads', discoveryRoutes);
  api.use('/analysis', analysisRoutes);
  api.use('/dashboard', dashboardRoutes);
  api.use('/data-sources', dataSourcesRoutes);
  api.use('/settings', settingsRoutes);
  app.use('/api', api);

  // Serve the built frontend in production (single-process deployment).
  if (IS_PROD) {
    const webDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');
    if (fs.existsSync(webDist)) {
      app.use(express.static(webDist));
      app.get('*', (_req, res) => res.sendFile(path.join(webDist, 'index.html')));
    }
  }

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
