import { Router } from 'express';
import crypto from 'node:crypto';
import { query } from '../config/db.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { llmEndpointLimiter } from '../middleware/rateLimit.js';
import { AppError } from '../middleware/errorHandler.js';
import { z } from 'zod';
import { runOrchestrator } from '../agents/orchestrator.js';

const router = Router();
router.use(requireAuth);

/**
 * Timing-safe string comparison to prevent timing side-channel attacks on secret comparison.
 */
function constantTimeEquals(provided, expected) {
  if (typeof provided !== 'string' || typeof expected !== 'string') return false;
  const a = Buffer.from(provided, 'utf-8');
  const b = Buffer.from(expected, 'utf-8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * POST /api/agents/run
 * Trigger a full orchestrator cycle for the current user.
 * Rate-limited via llmEndpointLimiter.
 */
router.post('/run', llmEndpointLimiter, async (req, res, next) => {
  try {
    const result = await runOrchestrator(req.user.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/agents/cron-trigger
 * Protected trigger endpoint allowing external cron pingers (cron-job.org, GitHub Actions, Upstash)
 * to wake the server and execute the scheduled orchestrator cycle.
 *
 * Security:
 * - Requires CRON_SECRET configured in environment variables (503 if unconfigured).
 * - Constant-time comparison on Authorization Bearer / x-cron-secret header (401 if invalid).
 * - Rate-limited per authenticated user.
 */
router.post('/cron-trigger', llmEndpointLimiter, async (req, res, next) => {
  try {
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret || cronSecret.trim().length === 0) {
      throw new AppError(
        503,
        'CRON_NOT_CONFIGURED',
        'Cron trigger is disabled: CRON_SECRET is not configured on this server.',
      );
    }

    const authHeader = req.headers.authorization || '';
    const bearerSecret = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    const headerSecret = req.headers['x-cron-secret'] || bearerSecret;

    if (!headerSecret || !constantTimeEquals(headerSecret, cronSecret)) {
      throw new AppError(401, 'UNAUTHORIZED', 'Invalid or missing cron secret.');
    }

    const result = await runOrchestrator(req.user.id);
    res.json({ status: 'ok', triggered_at: new Date().toISOString(), result });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/agents/logs
 * Paginated agent log, scoped to the current user.
 * Optional ?agent=monitor&invoice_id=... filters.
 */
const logsQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  agent: z.string().max(40).optional(),
  invoice_id: z.string().uuid().optional(),
});

router.get('/logs', validate({ query: logsQuery }), async (req, res, next) => {
  try {
    const { page, limit, agent, invoice_id } = req.query;
    const offset = (page - 1) * limit;

    let where = 'where user_id = $1';
    const params = [req.user.id];
    if (agent) {
      params.push(agent);
      where += ` and agent = $${params.length}`;
    }
    if (invoice_id) {
      params.push(invoice_id);
      where += ` and invoice_id = $${params.length}`;
    }

    const countRes = await query(`select count(*) from agent_logs ${where}`, params);
    const total = parseInt(countRes.rows[0].count, 10);

    const dataRes = await query(
      `select * from agent_logs ${where}
       order by created_at desc
       limit $${params.length + 1} offset $${params.length + 2}`,
      [...params, limit, offset],
    );

    res.json({ data: dataRes.rows, total, page, limit });
  } catch (err) {
    next(err);
  }
});

export default router;
