import { Router } from 'express';
import { query } from '../config/db.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { z } from 'zod';
import { runOrchestrator } from '../agents/orchestrator.js';

const router = Router();
router.use(requireAuth);

/**
 * POST /api/agents/run
 * Trigger a full orchestrator cycle for the current user.
 * Returns each step's result so the frontend can render progress.
 */
router.post('/run', async (req, res, next) => {
  try {
    const result = await runOrchestrator(req.user.id);
    res.json(result);
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
