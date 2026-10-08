import { runMonitor } from './monitor.js';
import { runAnalyst } from './analyst.js';

/**
 * Minimal orchestrator — Phase 2.
 *
 * Runs:  Monitor → Analyst
 *
 * Later phases add:  → Communicator → [Approval gate] → Send
 * Plus Negotiator (inbound) and Reconciler (payments).
 *
 * Returns step-by-step results so the frontend can show progress.
 */
export async function runOrchestrator(userId) {
  const steps = [];

  // Step 1 — Monitor: find overdue / at-risk invoices.
  const monitorResult = await runMonitor(userId);
  steps.push({
    agent: 'monitor',
    summary: `Found ${monitorResult.flagged_invoices.length} flagged invoice(s)`,
    data: monitorResult,
  });

  if (monitorResult.flagged_invoices.length === 0) {
    steps.push({
      agent: 'analyst',
      summary: 'Nothing to analyze — all invoices are healthy',
      data: { recommendations: [] },
    });
    return { steps };
  }

  // Step 2 — Analyst: prioritize and recommend tone/timing.
  const analystResult = await runAnalyst(userId, monitorResult);
  steps.push({
    agent: 'analyst',
    summary: `Generated ${analystResult.recommendations.length} recommendation(s)`,
    data: analystResult,
  });

  return { steps };
}
