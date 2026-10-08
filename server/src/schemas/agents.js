import { z } from 'zod';

/**
 * Zod schemas for LLM agent outputs.
 *
 * Every agent must return ONE of these shapes. If the LLM returns something
 * that doesn't match, llm.js retries once (appending the Zod error), then
 * falls back to a safe default (escalate to human).
 */

// ── Monitor ──────────────────────────────────────────────────────────────────

export const monitorOutputSchema = z.object({
  flagged_invoices: z.array(
    z.object({
      invoice_id: z.string(),
      invoice_no: z.string(),
      client_name: z.string(),
      days_overdue: z.number(),
      amount: z.number(),
      status: z.string(),
      urgency: z.enum(['low', 'medium', 'high', 'critical']),
    }),
  ),
});

// ── Analyst ──────────────────────────────────────────────────────────────────

export const analystOutputSchema = z.object({
  recommendations: z.array(
    z.object({
      invoice_id: z.string(),
      invoice_no: z.string(),
      priority: z.number().int().min(1).max(5),
      tone: z.enum(['friendly', 'firm', 'final']),
      timing: z.string(), // e.g. "send now", "wait 2 days"
      reasoning: z.string(),
      should_escalate: z.boolean().default(false),
    }),
  ),
});
