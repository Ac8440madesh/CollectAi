import { Router } from 'express';
import { query, pool } from '../config/db.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { AppError } from '../middleware/errorHandler.js';
import { llmEndpointLimiter } from '../middleware/rateLimit.js';
import { inboundMessageSchema } from '../schemas/resources.js';
import { runNegotiator } from '../agents/negotiator.js';
import { runEscalation } from '../agents/escalation.js';
import { sendEmail } from '../services/mailer.js';

const router = Router();
router.use(requireAuth);

/**
 * POST /api/communications/inbound
 * Evaluates an inbound client message, runs the Negotiator agent, and either
 * auto-replies in-policy (recording extensions in the DB) or routes to the Approvals queue.
 *
 * Rate-limited via llmEndpointLimiter.
 */
router.post('/inbound', llmEndpointLimiter, validate({ body: inboundMessageSchema }), async (req, res, next) => {
  const { invoice_id, client_message, channel } = req.body;
  const db = await pool.connect();
  try {
    await db.query('begin');

    // 1. Fetch invoice and verify user ownership
    const invRes = await db.query(
      `select i.*, c.id as client_id, c.name as client_name, c.email as client_email, c.phone as client_phone
       from invoices i
       join clients c on c.id = i.client_id
       where i.id = $1 and i.user_id = $2
       for update`,
      [invoice_id, req.user.id],
    );
    if (invRes.rowCount === 0) {
      throw new AppError(404, 'NOT_FOUND', 'Invoice not found');
    }
    const invoice = invRes.rows[0];
    const client = {
      id: invoice.client_id,
      name: invoice.client_name,
      email: invoice.client_email,
      phone: invoice.client_phone,
    };

    // 2. Fetch owner policy & user profile
    const userRes = await db.query('select name, business_name from users where id = $1', [req.user.id]);
    const user = userRes.rows[0];

    const policyRes = await db.query('select * from policies where user_id = $1', [req.user.id]);
    const policy = policyRes.rows[0] || {
      max_extension_days: 14,
      max_discount_pct: 10,
      min_partial_pct: 25,
      dry_run: true,
    };

    // 3. Record the inbound message in communications
    const inboundSubject = `Inbound message from ${client.name} regarding ${invoice.invoice_no}`;
    const inCommRes = await db.query(
      `insert into communications (invoice_id, direction, channel, subject, body, status)
       values ($1, 'inbound', $2, $3, $4, 'sent')
       returning id`,
      [invoice.id, channel, inboundSubject, client_message],
    );
    const inboundId = inCommRes.rows[0].id;

    // 4. Run Negotiator Agent
    const negotiation = await runNegotiator({
      userId: req.user.id,
      invoice,
      client,
      policy,
      user,
      clientMessage: client_message,
    });

    let approvalId = null;

    if (negotiation.escalate) {
      // Out-of-policy / dispute / injection -> Queue for owner approval
      const replySubject = `Re: Invoice ${invoice.invoice_no} (${negotiation.intent})`;
      const replyCommRes = await db.query(
        `insert into communications (invoice_id, direction, channel, subject, body, status)
         values ($1, 'outbound', $2, $3, $4, 'pending_approval')
         returning id`,
        [invoice.id, channel, replySubject, negotiation.proposed_response],
      );

      // Escalate to approvals with explicit kind ('dispute_review' or 'escalation')
      const approval = await runEscalation({
        userId: req.user.id,
        invoiceId: invoice.id,
        communicationId: replyCommRes.rows[0].id,
        kind: negotiation.intent === 'dispute' ? 'dispute_review' : 'escalation',
        reason: negotiation.escalation_reason || `Inbound reply requires review: ${negotiation.intent}`,
        recommendation:
          negotiation.intent === 'dispute'
            ? 'Review client dispute. Approving will mark invoice as "disputed" and send clarification notice.'
            : `Proposed resolution: ${negotiation.reasoning}`,
      });
      approvalId = approval.id;
    } else {
      // In-policy -> Store the exact calculated new_due_date in DB
      if (negotiation.proposed_terms?.new_due_date) {
        await db.query(
          'update invoices set extended_due_date = $1 where id = $2',
          [negotiation.proposed_terms.new_due_date, invoice.id],
        );
      }

      if (negotiation.proposed_terms?.promised_date) {
        await db.query(
          "update invoices set promised_pay_by = current_date + interval '7 days' where id = $1",
          [invoice.id],
        );
      }

      // Record outbound reply
      const replySubject = `Re: Payment arrangement for Invoice ${invoice.invoice_no}`;
      const replyCommRes = await db.query(
        `insert into communications (invoice_id, direction, channel, subject, body, status)
         values ($1, 'outbound', $2, $3, $4, 'sent')
         returning id`,
        [invoice.id, channel, replySubject, negotiation.proposed_response],
      );

      // Send via mailer
      await sendEmail({
        to: client.email,
        subject: replySubject,
        body: negotiation.proposed_response,
        dryRun: policy.dry_run,
      });

      await db.query(
        `insert into agent_logs (user_id, agent, invoice_id, input_summary, output_json, reasoning)
         values ($1, 'negotiator', $2, $3, $4, $5)`,
        [
          req.user.id,
          invoice.id,
          `Auto-replied to inbound reply for ${invoice.invoice_no} (${policy.dry_run ? 'dry run' : 'live'})`,
          JSON.stringify({ communication_id: replyCommRes.rows[0].id, negotiation }),
          `In-policy resolution executed: ${negotiation.reasoning}`,
        ],
      );
    }

    await db.query('commit');

    res.status(201).json({
      inbound_id: inboundId,
      negotiation,
      approval_id: approvalId,
    });
  } catch (err) {
    await db.query('rollback').catch(() => {});
    next(err);
  } finally {
    db.release();
  }
});

/**
 * GET /api/communications
 * Lists all communications for a given invoice (timeline history).
 */
router.get('/', async (req, res, next) => {
  try {
    const { invoice_id } = req.query;
    if (!invoice_id) {
      throw new AppError(400, 'VALIDATION_ERROR', 'invoice_id query parameter is required');
    }

    const result = await query(
      `select c.*
       from communications c
       join invoices i on i.id = c.invoice_id
       where i.id = $1 and i.user_id = $2
       order by c.created_at asc`,
      [invoice_id, req.user.id],
    );

    res.json({ data: result.rows, total: result.rowCount });
  } catch (err) {
    next(err);
  }
});

export default router;
