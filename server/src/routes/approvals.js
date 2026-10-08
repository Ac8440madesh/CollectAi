import { Router } from 'express';
import { query, pool } from '../config/db.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { AppError } from '../middleware/errorHandler.js';
import { sendEmail } from '../services/mailer.js';
import { validateDraft } from '../services/validators.js';
import { approvalIdParam, decideApprovalSchema } from '../schemas/resources.js';

const router = Router();
router.use(requireAuth);

/**
 * GET /api/approvals
 * Lists pending approvals with full invoice, client, and draft communication details.
 */
router.get('/', async (req, res, next) => {
  try {
    const result = await query(
      `select a.*,
              i.invoice_no, i.amount as invoice_amount, i.currency, i.due_date, i.status as invoice_status,
              c.name as client_name, c.email as client_email,
              comm.subject as draft_subject, comm.body as draft_body, comm.status as comm_status
       from approvals a
       join invoices i on i.id = a.invoice_id
       join clients c on c.id = i.client_id
       left join communications comm on comm.id = a.communication_id
       where a.user_id = $1 and a.status = 'pending'
       order by a.created_at desc`,
      [req.user.id],
    );

    res.json({ data: result.rows, total: result.rowCount });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/approvals/:id/decide
 * Execute human decision: approve, reject, or edit_and_approve.
 * Uses atomic row locking (SELECT ... FOR UPDATE) on a dedicated client.
 */
router.post('/:id/decide', validate({ params: approvalIdParam, body: decideApprovalSchema }), async (req, res, next) => {
  const { decision, edited_subject, edited_body } = req.body;
  const db = await pool.connect();
  try {
    await db.query('begin');

    // 1. Fetch approval item with pessimistic lock
    const appRes = await db.query(
      `select a.*,
              i.id as inv_id, i.invoice_no, i.amount as invoice_amount, i.paid_amount, i.due_date, i.status as invoice_status,
              c.name as client_name, c.email as client_email,
              comm.id as comm_id, comm.subject as comm_subject, comm.body as comm_body
       from approvals a
       join invoices i on i.id = a.invoice_id
       join clients c on c.id = i.client_id
       left join communications comm on comm.id = a.communication_id
       where a.id = $1 and a.user_id = $2
       for update`,
      [req.params.id, req.user.id],
    );

    if (appRes.rowCount === 0) {
      throw new AppError(404, 'NOT_FOUND', 'Approval item not found');
    }
    const item = appRes.rows[0];

    if (item.status !== 'pending') {
      throw new AppError(400, 'ALREADY_DECIDED', `This item has already been ${item.status}`);
    }

    // 2. Fetch user's policy for dry-run setting
    const policyRes = await db.query('select dry_run from policies where user_id = $1', [req.user.id]);
    const dryRun = policyRes.rows[0]?.dry_run ?? true;

    let finalSubject = item.comm_subject;
    let finalBody = item.comm_body;

    if (decision === 'reject') {
      // Mark approval rejected
      await db.query(
        "update approvals set status = 'rejected', decided_at = now() where id = $1",
        [req.params.id],
      );

      if (item.comm_id) {
        await db.query("update communications set status = 'draft' where id = $1", [item.comm_id]);
      }

      await db.query(
        `insert into agent_logs (user_id, agent, invoice_id, input_summary, output_json, reasoning)
         values ($1, 'approvals', $2, $3, $4, $5)`,
        [
          req.user.id,
          item.invoice_id,
          `Human owner rejected action for ${item.invoice_no}`,
          JSON.stringify({ approval_id: item.id, decision: 'rejected' }),
          `Owner rejected: ${item.reason}`,
        ],
      );

      await db.query('commit');
      return res.json({ id: item.id, status: 'rejected', decision });
    }

    if (decision === 'edit_and_approve') {
      finalSubject = edited_subject || item.comm_subject;
      finalBody = edited_body || item.comm_body;

      // Validate edited draft
      const validation = validateDraft({
        subject: finalSubject,
        body: finalBody,
        invoice: { invoice_no: item.invoice_no, amount: item.invoice_amount, paid_amount: item.paid_amount },
        client: { name: item.client_name },
      });

      if (!validation.valid) {
        throw new AppError(400, 'VALIDATION_ERROR', `Edited draft failed validation: ${validation.errors.join(', ')}`);
      }
    }

    // If approval was for a dispute, approving marks invoice as 'disputed'
    if (item.reason?.toLowerCase().includes('dispute') && item.invoice_status !== 'disputed') {
      await db.query("update invoices set status = 'disputed' where id = $1", [item.invoice_id]);
    }

    // Send or simulate sending
    const mailResult = await sendEmail({
      to: item.client_email,
      subject: finalSubject,
      body: finalBody,
      dryRun,
    });

    // Update communication
    if (item.comm_id) {
      await db.query(
        `update communications
         set subject = $1, body = $2, status = 'sent'
         where id = $3`,
        [finalSubject, finalBody, item.comm_id],
      );
    }

    // Mark approval approved
    await db.query(
      "update approvals set status = 'approved', decided_at = now() where id = $1",
      [req.params.id],
    );

    // Audit log
    await db.query(
      `insert into agent_logs (user_id, agent, invoice_id, input_summary, output_json, reasoning)
       values ($1, 'approvals', $2, $3, $4, $5)`,
      [
        req.user.id,
        item.invoice_id,
        `Human owner approved action for ${item.invoice_no} (${decision})`,
        JSON.stringify({ approval_id: item.id, decision, mailResult }),
        `Owner approved sending message (${dryRun ? 'dry run' : 'live'}).`,
      ],
    );

    await db.query('commit');
    res.json({ id: item.id, status: 'approved', decision, mailResult });
  } catch (err) {
    await db.query('rollback').catch(() => {});
    next(err);
  } finally {
    db.release();
  }
});

export default router;
