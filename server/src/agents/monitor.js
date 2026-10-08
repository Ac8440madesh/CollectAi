import { query } from '../config/db.js';
import { registerMock } from '../services/llm.js';
import { monitorOutputSchema } from '../schemas/agents.js';

/**
 * Monitor agent.
 *
 * Mostly deterministic SQL — finds invoices that are overdue or within 3 days
 * of the due date. No LLM call needed; the "intelligence" is in the urgency
 * bucketing. Logs to agent_logs for the audit trail.
 */
export async function runMonitor(userId) {
  const result = await query(
    `select i.id as invoice_id, i.invoice_no, c.name as client_name,
            i.amount::float as amount, i.status, i.due_date,
            (current_date - i.due_date) as days_overdue
     from invoices i
     join clients c on c.id = i.client_id
     where i.user_id = $1
       and i.status in ('pending', 'overdue', 'partial', 'disputed')
       and i.due_date <= current_date + interval '3 days'
     order by i.due_date asc`,
    [userId],
  );

  const flagged_invoices = result.rows.map((r) => {
    const days = parseInt(r.days_overdue, 10);
    let urgency = 'low';
    if (days > 60) urgency = 'critical';
    else if (days > 30) urgency = 'high';
    else if (days > 7) urgency = 'medium';

    return {
      invoice_id: r.invoice_id,
      invoice_no: r.invoice_no,
      client_name: r.client_name,
      days_overdue: days,
      amount: r.amount,
      status: r.status,
      urgency,
    };
  });

  const output = { flagged_invoices };
  const parsed = monitorOutputSchema.parse(output);

  // Log to agent_logs.
  await query(
    `insert into agent_logs (user_id, agent, input_summary, output_json, reasoning)
     values ($1, 'monitor', $2, $3, $4)`,
    [
      userId,
      `Scanned invoices for user (found ${parsed.flagged_invoices.length} flagged)`,
      JSON.stringify(parsed),
      `Found ${parsed.flagged_invoices.length} overdue or at-risk invoices`,
    ],
  );

  return parsed;
}

// ── Mock for LLM_MODE=mock ───────────────────────────────────────────────────
// Monitor doesn't call the LLM, but we register a mock so orchestrator
// integration tests can run uniformly.
registerMock('monitor', (ctx) => {
  // ctx.flaggedInvoices comes from the real SQL query in mock mode too,
  // but if needed for unit tests:
  return ctx?.flaggedInvoices ?? {
    flagged_invoices: [
      {
        invoice_id: '00000000-0000-0000-0000-000000000001',
        invoice_no: 'INV-MOCK-001',
        client_name: 'Mock Client',
        days_overdue: 15,
        amount: 25000,
        status: 'overdue',
        urgency: 'medium',
      },
    ],
  };
});
