import { query } from '../config/db.js';

/**
 * Guardrails Service.
 *
 * Enforces owner policy limits, approval gate rules, per-client rate limits,
 * and business hours constraints in the Asia/Kolkata timezone.
 */

// ── Approval Gate Rules ──────────────────────────────────────────────────────

export function checkApprovalGate({ invoice, invoices, policy, recommendation = {} }) {
  const invoiceList = invoices && invoices.length > 0 ? invoices : (invoice ? [invoice] : []);
  const threshold = parseFloat(policy.approval_amount_threshold || 50000);

  // Calculate total amount across the group
  const totalAmount = invoiceList.reduce((sum, inv) => sum + parseFloat(inv.amount || 0), 0);

  // Rule 1: Any disputed invoice
  const disputed = invoiceList.filter((inv) => inv.status === 'disputed');
  if (disputed.length > 0) {
    const disputedNos = disputed.map((d) => d.invoice_no).join(', ');
    return {
      needsApproval: true,
      reason: `Invoice(s) ${disputedNos} marked as disputed`,
      recommendation: 'Review client dispute before sending any collection notice',
    };
  }

  // Rule 2: Total amount exceeds owner's policy threshold
  if (totalAmount > threshold) {
    const invNos = invoiceList.map((i) => i.invoice_no).join(', ');
    return {
      needsApproval: true,
      reason: `Total invoice amount (₹${totalAmount.toLocaleString('en-IN')}) for ${invNos} exceeds approval threshold (₹${threshold.toLocaleString('en-IN')})`,
      recommendation: `High-value follow-up. Review and approve before sending ${recommendation.tone || 'reminder'} notice.`,
    };
  }

  // Rule 3: Analyst flagged for escalation (high client risk, critical priority)
  if (recommendation.should_escalate) {
    return {
      needsApproval: true,
      reason: `Analyst recommended human escalation: ${recommendation.reasoning}`,
      recommendation: `Verify account status and approve ${recommendation.tone || 'notice'}.`,
    };
  }

  return { needsApproval: false };
}

// ── Per-Client Rate Limiting ─────────────────────────────────────────────────

/**
 * Rate limit: At most one reminder per client every 3 days.
 * Only counts ACTUALLY SENT communications (status = 'sent'), not pending approvals or drafts.
 */
export async function checkClientRateLimit(clientId) {
  const result = await query(
    `select c.created_at, c.subject
     from communications c
     join invoices i on i.id = c.invoice_id
     where i.client_id = $1
       and c.direction = 'outbound'
       and c.status = 'sent'
       and c.created_at >= now() - interval '3 days'
     order by c.created_at desc
     limit 1`,
    [clientId],
  );

  if (result.rowCount > 0) {
    const lastSent = result.rows[0].created_at;
    return {
      rateLimited: true,
      lastSent,
      reason: `Client was already sent a reminder on ${new Date(lastSent).toLocaleDateString()} (Rate limit: 1 reminder per 3 days)`,
    };
  }

  return { rateLimited: false };
}

// ── Business Hours Check (Asia/Kolkata IST) ──────────────────────────────────

/**
 * Business hours: Monday to Friday, 9:00 AM to 6:00 PM (Asia/Kolkata).
 * In dry-run mode, can be bypassed so demos and automated tests are never blocked.
 *
 * @param {Date} [date] Date to evaluate (defaults to now)
 * @param {boolean} [dryRun=false] When true, bypasses restriction for testing/demo
 */
export function checkBusinessHours(date = new Date(), dryRun = false) {
  if (dryRun) {
    return {
      isBusinessHours: true,
      timezone: 'Asia/Kolkata',
      dryRunBypass: true,
    };
  }

  // Format date parts in Asia/Kolkata timezone
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    weekday: 'short',
    hour: 'numeric',
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const weekdayPart = parts.find((p) => p.type === 'weekday')?.value; // 'Mon', 'Tue', etc.
  const hourPart = parseInt(parts.find((p) => p.type === 'hour')?.value || '0', 10);

  const isWeekday = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(weekdayPart);
  const isWithinHours = hourPart >= 9 && hourPart < 18;

  return {
    isBusinessHours: isWeekday && isWithinHours,
    isWeekday,
    hourIST: hourPart,
    weekdayIST: weekdayPart,
    timezone: 'Asia/Kolkata',
    dryRunBypass: false,
  };
}
