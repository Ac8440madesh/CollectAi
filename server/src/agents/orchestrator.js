import { query } from '../config/db.js';
import { runMonitor } from './monitor.js';
import { runAnalyst } from './analyst.js';
import { runCommunicator } from './communicator.js';
import { runEscalation } from './escalation.js';
import { validateDraft } from '../services/validators.js';
import { sendEmail } from '../services/mailer.js';
import { checkApprovalGate, checkClientRateLimit, checkBusinessHours } from '../services/guardrails.js';

/**
 * Phase 3 & 4 Agent Orchestrator.
 *
 * Pipeline:
 *  1. Monitor -> finds overdue/at-risk invoices (excluding active dispute_review approvals)
 *  2. Analyst -> assigns priority, tone, timing, reasoning, and escalation flags
 *  3. Group by Client -> bundles multiple invoices for the same client:
 *     - Disputed invoices are EXCLUDED from collection groups and escalated individually for dispute resolution
 *     - Undisputed overdue invoices are grouped together and evaluated against the total group threshold
 *  4. Per action:
 *     a. Deduplication check (skip if pending approval already open)
 *     b. Rate limit check (max 1 sent reminder per 3 days per client)
 *     c. Communicator -> drafts message from DB facts
 *     d. Draft Validator -> verifies all invoice numbers and balances
 *     e. Approval Gate -> routes to Approvals Queue (with explicit kind) OR auto-sends (dry run / business hours)
 */
export async function runOrchestrator(userId) {
  const steps = [];
  const processed = [];

  // 0. Fetch user info and policy
  const userRes = await query('select id, name, email, business_name from users where id = $1', [userId]);
  const user = userRes.rows[0];

  let policyRes = await query('select * from policies where user_id = $1', [userId]);
  if (policyRes.rowCount === 0) {
    policyRes = await query(
      `insert into policies (user_id, max_extension_days, max_discount_pct, min_partial_pct, approval_amount_threshold, dry_run)
       values ($1, 14, 10, 25, 50000, true) returning *`,
      [userId],
    );
  }
  const policy = policyRes.rows[0];

  // 1. Monitor Step
  const monitorResult = await runMonitor(userId);
  steps.push({
    agent: 'monitor',
    summary: `Found ${monitorResult.flagged_invoices.length} flagged invoice(s)`,
    data: monitorResult,
  });

  if (monitorResult.flagged_invoices.length === 0) {
    steps.push({
      agent: 'analyst',
      summary: 'All invoices are healthy',
      data: { recommendations: [] },
    });
    return { steps, processed: [] };
  }

  // 2. Analyst Step
  const analystResult = await runAnalyst(userId, monitorResult);
  steps.push({
    agent: 'analyst',
    summary: `Generated ${analystResult.recommendations.length} recommendation(s)`,
    data: analystResult,
  });

  // Pre-fetch invoice details and client info
  const invoiceIds = monitorResult.flagged_invoices.map((f) => f.invoice_id);
  const invDetailsRes = await query(
    `select i.*, c.id as client_id, c.name as client_name, c.email as client_email,
            (current_date - i.due_date) as days_overdue
     from invoices i
     join clients c on c.id = i.client_id
     where i.id = any($1)`,
    [invoiceIds],
  );
  const invMap = Object.fromEntries(invDetailsRes.rows.map((r) => [r.id, r]));
  const recMap = Object.fromEntries(analystResult.recommendations.map((r) => [r.invoice_id, r]));

  // 3. Separate actions: Disputed invoices (individual dispute resolution) vs Undisputed (grouped by client)
  const actionItems = [];

  const clientUndisputedGroups = {};
  for (const f of monitorResult.flagged_invoices) {
    const inv = invMap[f.invoice_id];
    if (!inv) continue;

    if (inv.status === 'disputed') {
      // Disputed invoice: handled individually with dispute_resolution tone
      actionItems.push({
        client: { id: inv.client_id, name: inv.client_name, email: inv.client_email },
        invoices: [inv],
        isDisputed: true,
      });
    } else {
      if (!clientUndisputedGroups[inv.client_id]) {
        clientUndisputedGroups[inv.client_id] = {
          client: { id: inv.client_id, name: inv.client_name, email: inv.client_email },
          invoices: [],
          isDisputed: false,
        };
      }
      clientUndisputedGroups[inv.client_id].invoices.push(inv);
    }
  }

  for (const group of Object.values(clientUndisputedGroups)) {
    actionItems.push(group);
  }

  // 4. Process each action item
  for (const item of actionItems) {
    const { client, invoices, isDisputed } = item;
    const invNos = invoices.map((i) => i.invoice_no).join(', ');

    // a. Deduplication check: Is there already an open pending approval for any of these invoices?
    const existingAppRes = await query(
      `select id from approvals
       where invoice_id = any($1) and status = 'pending' and user_id = $2`,
      [invoices.map((i) => i.id), userId],
    );
    if (existingAppRes.rowCount > 0) {
      processed.push({
        client_name: client.name,
        invoice_numbers: invNos,
        action: 'skipped_already_pending_approval',
        reason: `Pending approval already active for ${invNos}`,
      });
      continue;
    }

    // b. Rate limit check (only checks actually sent messages within 3 days)
    const rateCheck = await checkClientRateLimit(client.id);
    if (rateCheck.rateLimited) {
      await query(
        `insert into agent_logs (user_id, agent, input_summary, output_json, reasoning)
         values ($1, 'guardrails', $2, $3, $4)`,
        [
          userId,
          `Rate limit active for ${client.name}`,
          JSON.stringify(rateCheck),
          rateCheck.reason,
        ],
      );
      processed.push({
        client_name: client.name,
        invoice_numbers: invNos,
        action: 'skipped_rate_limit',
        reason: rateCheck.reason,
      });
      continue;
    }

    // Determine tone & recommendation
    const groupRecs = invoices.map((inv) => recMap[inv.id]).filter(Boolean);
    const hasFinal = groupRecs.some((r) => r.tone === 'final');
    const hasFirm = groupRecs.some((r) => r.tone === 'firm');

    const effectiveTone = isDisputed
      ? 'dispute_resolution'
      : hasFinal
        ? 'final'
        : hasFirm
          ? 'firm'
          : 'friendly';

    const effectiveRec = {
      tone: effectiveTone,
      reasoning: groupRecs.map((r) => r.reasoning).join('; ') || `Follow-up for ${invNos}`,
      should_escalate: groupRecs.some((r) => r.should_escalate) || isDisputed,
    };

    // c. Communicator Step (drafts message for the invoice(s))
    let draft = await runCommunicator({
      userId,
      invoices,
      client,
      user,
      recommendation: effectiveRec,
    });

    // d. Draft Validator Step
    let validation = validateDraft({
      subject: draft.subject,
      body: draft.body,
      invoices,
      client,
      user,
    });

    if (!validation.valid) {
      // Retry once with validation errors
      draft = await runCommunicator({
        userId,
        invoices,
        client,
        user,
        recommendation: { ...effectiveRec, reasoning: `${effectiveRec.reasoning}. PREVIOUS DRAFT FAILED VALIDATION: ${validation.errors.join('; ')}` },
      });
      validation = validateDraft({
        subject: draft.subject,
        body: draft.body,
        invoices,
        client,
        user,
      });
    }

    // If still invalid after retry, escalate to human
    if (!validation.valid) {
      const commRes = await query(
        `insert into communications (invoice_id, direction, channel, subject, body, status)
         values ($1, 'outbound', 'email', $2, $3, 'pending_approval')
         returning id`,
        [invoices[0].id, draft.subject, draft.body],
      );
      await runEscalation({
        userId,
        invoiceId: invoices[0].id,
        communicationId: commRes.rows[0].id,
        kind: 'validation_failure',
        reason: `Draft failed validation: ${validation.errors.join(', ')}`,
        recommendation: 'Review and manually edit email before sending',
      });
      processed.push({
        client_name: client.name,
        invoice_numbers: invNos,
        action: 'escalated_validation_failure',
        errors: validation.errors,
      });
      continue;
    }

    // e. Approval Gate Check (checks total group amount against policy threshold)
    const gate = checkApprovalGate({
      invoices,
      policy,
      recommendation: effectiveRec,
    });

    if (gate.needsApproval) {
      // Create communication in pending_approval linked to the primary invoice
      const commRes = await query(
        `insert into communications (invoice_id, direction, channel, subject, body, status)
         values ($1, 'outbound', 'email', $2, $3, 'pending_approval')
         returning id`,
        [invoices[0].id, draft.subject, draft.body],
      );

      const approvalKind = isDisputed
        ? 'dispute_review'
        : gate.reason?.toLowerCase().includes('exceeds approval threshold')
          ? 'high_value'
          : 'escalation';

      // Create approval item
      const approval = await runEscalation({
        userId,
        invoiceId: invoices[0].id,
        communicationId: commRes.rows[0].id,
        kind: approvalKind,
        reason: gate.reason,
        recommendation: gate.recommendation,
      });

      processed.push({
        client_name: client.name,
        invoice_numbers: invNos,
        action: 'queued_for_approval',
        approval_id: approval.id,
        reason: gate.reason,
      });
    } else {
      // f. Check Business Hours in Live Mode (dry_run = false)
      const bhCheck = checkBusinessHours(new Date(), policy.dry_run);
      if (!bhCheck.isBusinessHours) {
        await query(
          `insert into agent_logs (user_id, agent, invoice_id, input_summary, output_json, reasoning)
           values ($1, 'guardrails', $2, $3, $4, $5)`,
          [
            userId,
            invoices[0].id,
            `Live send deferred: outside IST business hours for ${invNos}`,
            JSON.stringify(bhCheck),
            'Outside Monday-Friday 9:00 AM - 6:00 PM (Asia/Kolkata). Deferring dispatch.',
          ],
        );
        processed.push({
          client_name: client.name,
          invoice_numbers: invNos,
          action: 'deferred_outside_business_hours',
          reason: 'Outside Asia/Kolkata business hours (9 AM - 6 PM IST)',
        });
        continue;
      }

      // Auto-processed: save communication as sent and call mailer (dry run default)
      const commRes = await query(
        `insert into communications (invoice_id, direction, channel, subject, body, status)
         values ($1, 'outbound', 'email', $2, $3, 'sent')
         returning id`,
        [invoices[0].id, draft.subject, draft.body],
      );

      const mailResult = await sendEmail({
        to: client.email,
        subject: draft.subject,
        body: draft.body,
        dryRun: policy.dry_run,
      });

      await query(
        `insert into agent_logs (user_id, agent, invoice_id, input_summary, output_json, reasoning)
         values ($1, 'communicator', $2, $3, $4, $5)`,
        [
          userId,
          invoices[0].id,
          `Auto-sent reminder for ${invNos} (${policy.dry_run ? 'dry run' : 'live'})`,
          JSON.stringify({ communication_id: commRes.rows[0].id, mailResult }),
          `In-policy auto-reminder sent to ${client.name} for ${invNos}`,
        ],
      );

      processed.push({
        client_name: client.name,
        invoice_numbers: invNos,
        action: 'auto_sent',
        dry_run: policy.dry_run,
        subject: draft.subject,
      });
    }
  }

  steps.push({
    agent: 'communicator',
    summary: `Processed ${processed.length} client action(s)`,
    data: { processed },
  });

  return { steps, processed };
}
