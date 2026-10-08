import { Router } from 'express';
import { pool } from '../config/db.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { AppError } from '../middleware/errorHandler.js';
import { createPaymentSchema } from '../schemas/resources.js';

const router = Router();
router.use(requireAuth);

/**
 * POST /api/payments
 * Records a payment against an invoice.
 *
 * Guardrails:
 * - Reject non-positive amounts (enforced by Zod schema: positive()).
 * - Reject payments on already fully-paid invoices (400 INVOICE_ALREADY_PAID).
 * - Reject payments exceeding the remaining balance (400 EXCEEDS_BALANCE).
 * - Updates invoice paid_amount and status ('partial' | 'paid') in a single transaction.
 */
router.post('/', validate({ body: createPaymentSchema }), async (req, res, next) => {
  const { invoice_id, amount, paid_on, method, reference } = req.body;
  const db = await pool.connect();
  try {
    await db.query('begin');

    // Lock the invoice row and verify ownership.
    const invRes = await db.query(
      'select id, amount, paid_amount, status from invoices where id = $1 and user_id = $2 for update',
      [invoice_id, req.user.id],
    );
    if (invRes.rowCount === 0) {
      throw new AppError(404, 'NOT_FOUND', 'Invoice not found');
    }
    const invoice = invRes.rows[0];

    const totalAmount = parseFloat(invoice.amount);
    const currentPaid = parseFloat(invoice.paid_amount);
    const remainingBalance = Math.round((totalAmount - currentPaid) * 100) / 100;

    if (remainingBalance <= 0 || invoice.status === 'paid') {
      throw new AppError(400, 'INVOICE_ALREADY_PAID', 'Invoice is already fully paid');
    }

    if (amount > remainingBalance) {
      throw new AppError(
        400,
        'EXCEEDS_BALANCE',
        `Payment amount (${amount}) exceeds remaining balance (${remainingBalance})`,
      );
    }

    // Insert payment record.
    const paymentRes = await db.query(
      `insert into payments (invoice_id, amount, paid_on, method, reference)
       values ($1, $2, coalesce($3, current_date), $4, $5)
       returning *`,
      [invoice_id, amount, paid_on ?? null, method ?? null, reference ?? null],
    );

    const newPaid = Math.round((currentPaid + amount) * 100) / 100;
    const newStatus = newPaid >= totalAmount ? 'paid' : 'partial';

    await db.query(
      'update invoices set paid_amount = $1, status = $2 where id = $3',
      [newPaid, newStatus, invoice_id],
    );

    await db.query('commit');

    res.status(201).json({
      payment: paymentRes.rows[0],
      invoice: { id: invoice_id, paid_amount: newPaid, status: newStatus },
    });
  } catch (err) {
    await db.query('rollback').catch(() => {});
    next(err);
  } finally {
    db.release();
  }
});

export default router;
