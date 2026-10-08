import { query } from '../config/db.js';

/**
 * Named constant: 75% on-time credit awarded when an invoice is fully settled
 * within an agreed extension window (extended_due_date).
 */
export const EXTENSION_ON_TIME_CREDIT = 0.75;

/**
 * Single canonical rounding rule used across all scoring math.
 * JavaScript's Math.round() rounds halves toward +Infinity (round-half-up) for
 * positive values: round(39.5) -> 40, round(72.5) -> 73.
 */
export function roundHalfUp(n) {
  return Math.round(n);
}

/**
 * Pure scoring function — computes client payment metrics from invoice rows.
 * Shared by `recomputeClientScore` and the demo scenario audit so they NEVER diverge.
 *
 * Each row must contain: { amount, due_date, extended_due_date, status, latest_payment_date }
 *
 * Rules:
 * - Only fully settled ('paid') invoices are scored for the on-time rate.
 * - Partially paid / overdue / disputed invoices are EXCLUDED from on-time rate,
 *   but each adds +10 to the risk score (overdue penalty).
 * - avg_days_late is rounded to 2 decimals BEFORE it feeds the risk formula.
 * - risk_score uses a single round-half-up at the very end.
 */
export function computeScores(invoiceRows) {
  if (!invoiceRows || invoiceRows.length === 0) {
    return {
      avg_days_late: 0,
      on_time_rate: 100,
      risk_score: 0,
      unrounded_risk: 0,
      paid_count: 0,
      overdue_count: 0,
      line_items: [],
    };
  }

  let totalDaysLate = 0;
  let paidCount = 0;
  let onTimeScoreSum = 0;
  let overdueCount = 0;
  const lineItems = [];

  for (const inv of invoiceRows) {
    if (inv.status === 'paid' && inv.latest_payment_date) {
      paidCount += 1;
      const originalDueDate = new Date(inv.due_date);
      const effectiveDueDate = inv.extended_due_date ? new Date(inv.extended_due_date) : originalDueDate;
      const paidDate = new Date(inv.latest_payment_date);

      const daysDiffOriginal = Math.round((paidDate - originalDueDate) / 86400000);
      const daysDiffEffective = Math.round((paidDate - effectiveDueDate) / 86400000);

      let credit;
      let daysLate = 0;
      if (daysDiffOriginal <= 0) {
        credit = 1.0; // Category 1: On or before original due date
      } else if (daysDiffEffective <= 0) {
        credit = EXTENSION_ON_TIME_CREDIT; // Category 2: Within agreed extension
      } else {
        credit = 0.0; // Category 3: Late past effective due date
        daysLate = daysDiffEffective;
        totalDaysLate += daysDiffEffective;
      }
      onTimeScoreSum += credit;
      lineItems.push({ invoice_no: inv.invoice_no, credit, days_late: daysLate });
    } else if (inv.status === 'overdue' || inv.status === 'disputed' || inv.status === 'partial') {
      overdueCount += 1;
    }
  }

  // avg_days_late: round to 2 decimals before it feeds the risk formula
  const avg_days_late = paidCount > 0 ? roundHalfUp((totalDaysLate / paidCount) * 100) / 100 : 0;
  const on_time_rate = paidCount > 0 ? roundHalfUp((onTimeScoreSum / paidCount) * 100) : 50;

  // Composite risk: Base + Late penalty (capped 30) + Overdue penalty (10 each)
  const unrounded_risk = (100 - on_time_rate) * 0.5 + Math.min(avg_days_late * 1.5, 30) + overdueCount * 10;
  const risk_score = Math.min(Math.max(roundHalfUp(unrounded_risk), 0), 100);

  return {
    avg_days_late,
    on_time_rate,
    risk_score,
    unrounded_risk,
    paid_count: paidCount,
    overdue_count: overdueCount,
    line_items: lineItems,
  };
}

/**
 * Recompute a client's payment behaviour metrics and persist to client_scores.
 */
export async function recomputeClientScore(clientId) {
  const invRes = await query(
    `select i.id, i.invoice_no, i.amount, i.due_date, i.extended_due_date, i.status,
            max(p.paid_on) as latest_payment_date
     from invoices i
     left join payments p on p.invoice_id = i.id
     where i.client_id = $1
     group by i.id`,
    [clientId],
  );

  const scores = computeScores(invRes.rows);

  await query(
    `insert into client_scores (client_id, avg_days_late, on_time_rate, risk_score, updated_at)
     values ($1, $2, $3, $4, now())
     on conflict (client_id) do update set
       avg_days_late = excluded.avg_days_late,
       on_time_rate = excluded.on_time_rate,
       risk_score = excluded.risk_score,
       updated_at = now()`,
    [clientId, scores.avg_days_late, scores.on_time_rate, scores.risk_score],
  );

  return {
    avg_days_late: scores.avg_days_late,
    on_time_rate: scores.on_time_rate,
    risk_score: scores.risk_score,
  };
}
