import { Router } from 'express';
import { query } from '../config/db.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { AppError } from '../middleware/errorHandler.js';
import {
  createClientSchema,
  updateClientSchema,
  clientIdParam,
  paginationQuery,
} from '../schemas/resources.js';

const router = Router();
router.use(requireAuth);

/**
 * GET /api/clients
 * List all clients for the current user, with optional search.
 */
router.get('/', validate({ query: paginationQuery }), async (req, res, next) => {
  try {
    const { page, limit, search } = req.query;
    const offset = (page - 1) * limit;

    let where = 'where c.user_id = $1';
    const params = [req.user.id];
    if (search) {
      params.push(`%${search}%`);
      where += ` and (c.name ilike $${params.length} or c.email ilike $${params.length})`;
    }

    const countRes = await query(`select count(*) from clients c ${where}`, params);
    const total = parseInt(countRes.rows[0].count, 10);

    const dataRes = await query(
      `select c.*, cs.risk_score, cs.avg_days_late, cs.on_time_rate
       from clients c
       left join client_scores cs on cs.client_id = c.id
       ${where}
       order by c.created_at desc
       limit $${params.length + 1} offset $${params.length + 2}`,
      [...params, limit, offset],
    );

    res.json({ data: dataRes.rows, total, page, limit });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/clients
 */
router.post('/', validate({ body: createClientSchema }), async (req, res, next) => {
  try {
    const { name, email, phone, payment_terms_days, notes } = req.body;
    const result = await query(
      `insert into clients (user_id, name, email, phone, payment_terms_days, notes)
       values ($1, $2, $3, $4, $5, $6)
       returning *`,
      [req.user.id, name, email ?? null, phone ?? null, payment_terms_days, notes ?? null],
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/clients/:id
 * Only the owner can update their own client.
 */
router.put('/:id', validate({ params: clientIdParam, body: updateClientSchema }), async (req, res, next) => {
  try {
    const fields = req.body;
    if (Object.keys(fields).length === 0) {
      throw new AppError(400, 'VALIDATION_ERROR', 'No fields to update');
    }

    // Build SET clause dynamically from the (already validated) body.
    const keys = Object.keys(fields);
    const sets = keys.map((k, i) => `${k} = $${i + 3}`);
    const values = keys.map((k) => fields[k] ?? null);

    const result = await query(
      `update clients set ${sets.join(', ')}
       where id = $1 and user_id = $2
       returning *`,
      [req.params.id, req.user.id, ...values],
    );

    if (result.rowCount === 0) throw new AppError(404, 'NOT_FOUND', 'Client not found');
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/clients/:id
 * Cascades to invoices, payments, etc.
 */
router.delete('/:id', validate({ params: clientIdParam }), async (req, res, next) => {
  try {
    const result = await query(
      'delete from clients where id = $1 and user_id = $2',
      [req.params.id, req.user.id],
    );
    if (result.rowCount === 0) throw new AppError(404, 'NOT_FOUND', 'Client not found');
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});

export default router;
