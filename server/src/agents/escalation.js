import { query } from '../config/db.js';

/**
 * Escalation Agent.
 *
 * Flags an invoice communication for human owner approval. Creates an approvals row
 * with explicit kind classification ('dispute_review', 'high_value', 'escalation'),
 * reasoning, and actionable recommendation, and logs to the audit trail.
 *
 * Gracefully handles the unique constraint if an approval is already pending for this invoice.
 */
export async function runEscalation({
  userId,
  invoiceId,
  communicationId,
  kind = 'escalation',
  reason,
  recommendation,
}) {
  // 1. Check if a pending approval already exists for this invoice
  const existingRes = await query(
    "select * from approvals where invoice_id = $1 and status = 'pending' and user_id = $2",
    [invoiceId, userId],
  );
  if (existingRes.rowCount > 0) {
    return existingRes.rows[0];
  }

  // 2. Insert approval queue item with explicit kind
  let approvalRow;
  try {
    const approvalRes = await query(
      `insert into approvals (user_id, invoice_id, communication_id, kind, reason, recommendation, status)
       values ($1, $2, $3, $4, $5, $6, 'pending')
       returning *`,
      [userId, invoiceId, communicationId ?? null, kind, reason, recommendation],
    );
    approvalRow = approvalRes.rows[0];
  } catch (err) {
    // 23505: unique_violation on partial unique index idx_approvals_unique_pending_invoice
    if (err.code === '23505') {
      const fallback = await query(
        "select * from approvals where invoice_id = $1 and status = 'pending' and user_id = $2",
        [invoiceId, userId],
      );
      return fallback.rows[0];
    }
    throw err;
  }

  // 3. If a draft communication exists, update its status to pending_approval
  if (communicationId) {
    await query(
      "update communications set status = 'pending_approval' where id = $1",
      [communicationId],
    );
  }

  // 4. Log to agent_logs
  await query(
    `insert into agent_logs (user_id, agent, invoice_id, input_summary, output_json, reasoning)
     values ($1, 'escalation', $2, $3, $4, $5)`,
    [
      userId,
      invoiceId,
      `Escalated to human owner [${kind}]: ${reason}`,
      JSON.stringify(approvalRow),
      `Escalation recommendation: ${recommendation}`,
    ],
  );

  return approvalRow;
}
