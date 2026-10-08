import { query } from '../config/db.js';
import { promptJSON, registerMock } from '../services/llm.js';
import { analystOutputSchema } from '../schemas/agents.js';

/**
 * Analyst agent.
 *
 * Takes the Monitor's flagged invoices, enriches with client payment history
 * and risk scores, then asks the LLM to recommend a priority, tone, timing,
 * and whether to escalate.
 */
export async function runAnalyst(userId, monitorOutput) {
  const { flagged_invoices } = monitorOutput;
  if (flagged_invoices.length === 0) {
    const empty = { recommendations: [] };
    await query(
      `insert into agent_logs (user_id, agent, input_summary, output_json, reasoning)
       values ($1, 'analyst', 'No flagged invoices', $2, 'Nothing to analyze')`,
      [userId, JSON.stringify(empty)],
    );
    return empty;
  }

  // Gather client scores for enrichment.
  const clientNames = [...new Set(flagged_invoices.map((f) => f.client_name))];
  const scoresRes = await query(
    `select c.name, cs.avg_days_late, cs.on_time_rate, cs.risk_score
     from clients c
     join client_scores cs on cs.client_id = c.id
     where c.user_id = $1 and c.name = any($2)`,
    [userId, clientNames],
  );
  const scoreMap = Object.fromEntries(scoresRes.rows.map((r) => [r.name, r]));

  // Build context for the LLM.
  const invoiceData = flagged_invoices.map((inv) => ({
    ...inv,
    client_score: scoreMap[inv.client_name] ?? null,
  }));

  const system = `You are a collections analyst AI for a small business.
You receive overdue/at-risk invoices with client history and risk scores.

For each invoice, recommend:
- priority (1 = lowest, 5 = highest urgency)
- tone: "friendly" for first reminder or good history, "firm" for repeat offenders, "final" for critical
- timing: when to send (e.g. "send now", "wait 2 days", "send Monday morning")
- reasoning: one-sentence explanation
- should_escalate: true ONLY if disputed, amount very large, or risk_score > 80

Return JSON: { "recommendations": [ { invoice_id, invoice_no, priority, tone, timing, reasoning, should_escalate } ] }`;

  const user = `Analyze these invoices:\n${JSON.stringify(invoiceData, null, 2)}`;

  const { data } = await promptJSON({
    agent: 'analyst',
    system,
    user,
    schema: analystOutputSchema,
    context: { invoiceData },
  });

  // Log each recommendation individually for the per-invoice timeline.
  for (const rec of data.recommendations) {
    await query(
      `insert into agent_logs (user_id, agent, invoice_id, input_summary, output_json, reasoning)
       values ($1, 'analyst', $2, $3, $4, $5)`,
      [
        userId,
        rec.invoice_id,
        `Analyzed ${rec.invoice_no}`,
        JSON.stringify(rec),
        rec.reasoning,
      ],
    );
  }

  return data;
}

// ── Mock ─────────────────────────────────────────────────────────────────────

registerMock('analyst', (ctx) => {
  const invoiceData = ctx?.invoiceData ?? [];
  return {
    recommendations: invoiceData.map((inv) => {
      let tone = 'friendly';
      let priority = 2;
      const risk = inv.client_score?.risk_score ?? 0;

      if (inv.days_overdue > 30 || risk > 60) {
        tone = 'firm';
        priority = 4;
      }
      if (inv.days_overdue > 60 || risk > 80 || inv.status === 'disputed') {
        tone = 'final';
        priority = 5;
      }

      return {
        invoice_id: inv.invoice_id,
        invoice_no: inv.invoice_no,
        priority,
        tone,
        timing: inv.days_overdue > 30 ? 'send now' : 'send within 2 days',
        reasoning: `${inv.client_name}: ${inv.days_overdue} days overdue, risk score ${risk}. Recommending ${tone} tone.`,
        should_escalate: inv.status === 'disputed' || risk > 80,
      };
    }),
  };
});
