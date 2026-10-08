import express from 'express';
import helmet from 'helmet';
import cors from 'cors';

import { env } from './config/env.js';
import { apiLimiter } from './middleware/rateLimit.js';
import { notFound, errorHandler } from './middleware/errorHandler.js';
import authRouter from './routes/auth.js';
import clientsRouter from './routes/clients.js';
import invoicesRouter from './routes/invoices.js';
import paymentsRouter from './routes/payments.js';
import agentsRouter from './routes/agents.js';
import policyRouter from './routes/policy.js';
import approvalsRouter from './routes/approvals.js';
import communicationsRouter from './routes/communications.js';
import dashboardRouter from './routes/dashboard.js';

/**
 * Build the Express app.
 *
 * Kept separate from `index.js` (which starts the HTTP listener) so tests can
 * import the app with Supertest without opening a port. Routes mount under
 * `/api` and grow phase by phase.
 */
export function createApp() {
  const app = express();

  // Trust reverse proxy header (Render, Vercel, load balancers)
  app.set('trust proxy', 1);

  app.use(helmet());
  app.use(cors({ origin: env.FRONTEND_ORIGIN, credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));
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

  // Feature routes.
  app.use('/api/auth', authRouter);
  app.use('/api/clients', clientsRouter);
  app.use('/api/invoices', invoicesRouter);
  app.use('/api/payments', paymentsRouter);
  app.use('/api/agents', agentsRouter);
  app.use('/api/policy', policyRouter);
  app.use('/api/approvals', approvalsRouter);
  app.use('/api/communications', communicationsRouter);
  app.use('/api/dashboard', dashboardRouter);

  // 404 + central error handler (must be last).
  app.use(notFound);
  app.use(errorHandler);

  return app;
}
