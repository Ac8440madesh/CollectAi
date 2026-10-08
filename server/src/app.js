import express from 'express';
import helmet from 'helmet';
import cors from 'cors';

import { env } from './config/env.js';
import { apiLimiter } from './middleware/rateLimit.js';
import { notFound, errorHandler } from './middleware/errorHandler.js';

/**
 * Build the Express app.
 *
 * Kept separate from `index.js` (which starts the HTTP listener) so tests can
 * import the app with Supertest without opening a port. Routes are mounted
 * under `/api` and grow phase by phase; Phase 0 ships only `/api/health`.
 */
export function createApp() {
  const app = express();

  // Security headers.
  app.use(helmet());

  // Allow the frontend origin only.
  app.use(cors({ origin: env.FRONTEND_ORIGIN, credentials: true }));

  // Body parsing.
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));

  // Rate limiting across the API.
  app.use('/api', apiLimiter);

  // Health check — used by Render and by the client to confirm wiring.
  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'collectai-api',
      env: env.NODE_ENV,
      time: new Date().toISOString(),
    });
  });

  // 404 + central error handler (must be last).
  app.use(notFound);
  app.use(errorHandler);

  return app;
}
