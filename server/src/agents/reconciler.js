import { query } from '../config/db.js';
import { recomputeClientScore } from '../services/scoring.js';

/**
 * Reconciler Agent.
 *
 * Triggered whenever a payment is recorded.
 * 1. Closes pending follow-up chains and approval items if the invoice is fully settled.
 * 2. Recomputes the client's risk score and payment behaviour metrics.
 * 3. Logs reconciliation events to the audit trail.
 */
export async function runReconciler({ userId, invoiceId, paymentAmount, newStatus }) {
  // 1. Fetch invoice and client
  const invRes = await query(
    'select i.id, i.invoice_no, i.amount, i.paid_amount, i.client_id, c.name as client_name from invoices i join clients c on c.id = i.client_id where i.id = $1 and i.user_id = $2',
    [invoiceId, userId],
  );
  if (invRes.rowCount === 0) return null;
  const invoice = invRes.rows[0];

  // 2. If invoice is fully paid, close pending approvals and drafts
  let closedApprovalsCount = 0;
  if (newStatus === 'paid') {
    const appCloseRes = await query(
      `update approvals
       set status = 'approved', decided_at = now()
       where invoice_id = $1 and status = 'pending' and user_id = $2
       returning id`,
      [invoiceId, userId],
    );
    closedApprovalsCount = appCloseRes.rowCount;

    await query(
      "update communications set status = 'sent' where invoice_id = $1 and status = 'pending_approval'",
      [invoiceId],
    );

    // Audit log
    await query(
      `insert into agent_logs (user_id, agent, invoice_id, input_summary, output_json, reasoning)
       values ($1, 'reconciler', $2, $3, $4, $5)`,
      [
        userId,
        invoiceId,
        `Reconciled full payment of ₹${paymentAmount.toLocaleString('en-IN')} for ${invoice.invoice_no}`,
        JSON.stringify({ paymentAmount, newStatus, closedApprovalsCount }),
        `Invoice ${invoice.invoice_no} is fully paid. Closed ${closedApprovalsCount} pending follow-up task(s).`,
      ],
    );
  } else {
    // Partial payment audit log
    await query(
      `insert into agent_logs (user_id, agent, invoice_id, input_summary, output_json, reasoning)
       values ($1, 'reconciler', $2, $3, $4, $5)`,
      [
        userId,
        invoiceId,
        `Reconciled partial payment of ₹${paymentAmount.toLocaleString('en-IN')} for ${invoice.invoice_no}`,
        JSON.stringify({ paymentAmount, newStatus }),
        `Recorded partial payment. Remaining balance: ₹${(parseFloat(invoice.amount) - parseFloat(invoice.paid_amount)).toLocaleString('en-IN')}`,
      ],
    );
  }

  // 3. Recompute client payment metrics and risk score
  const updatedScore = await recomputeClientScore(invoice.client_id);

  return {
    invoice_id: invoiceId,
    newStatus,
    closedApprovalsCount,
    updatedScore,
  };
}
