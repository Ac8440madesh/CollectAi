import { Router } from 'express';
import { query } from '../config/db.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { AppError } from '../middleware/errorHandler.js';
import { updatePolicySchema } from '../schemas/resources.js';

const router = Router();
router.use(requireAuth);

/**
 * GET /api/policy
 * Returns the current user's guardrail policy.
 */
router.get('/', async (req, res, next) => {
  try {
    let result = await query('select * from policies where user_id = $1', [req.user.id]);

    if (result.rowCount === 0) {
      // Create default policy row if missing
      result = await query(
        `insert into policies (user_id, max_extension_days, max_discount_pct, min_partial_pct, approval_amount_threshold, dry_run)
         values ($1, 14, 10, 25, 50000, true)
         returning *`,
        [req.user.id],
      );
    }

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/policy
 * Updates the user's guardrail policy.
 */
router.put('/', validate({ body: updatePolicySchema }), async (req, res, next) => {
  try {
    const fields = req.body;
    if (Object.keys(fields).length === 0) {
      throw new AppError(400, 'VALIDATION_ERROR', 'No fields provided to update');
    }

    const keys = Object.keys(fields);
    const sets = keys.map((k, i) => `${k} = $${i + 2}`);
    const values = keys.map((k) => fields[k]);

    const result = await query(
      `update policies set ${sets.join(', ')}
       where user_id = $1
       returning *`,
      [req.user.id, ...values],
    );

    if (result.rowCount === 0) {
      throw new AppError(404, 'NOT_FOUND', 'Policy not found for user');
    }

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

export default router;
