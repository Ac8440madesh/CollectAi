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
      tone: z.enum(['friendly', 'firm', 'final', 'dispute_resolution']),
      timing: z.string(), // e.g. "send now", "wait 2 days"
      reasoning: z.string(),
      should_escalate: z.boolean().default(false),
    }),
  ),
});

// ── Communicator ─────────────────────────────────────────────────────────────

export const communicatorOutputSchema = z.object({
  subject: z.string().trim().min(3, 'Subject must be at least 3 characters').max(200),
  body: z.string().trim().min(10, 'Body must be at least 10 characters').max(4000),
});

// ── Negotiator ───────────────────────────────────────────────────────────────

export const negotiatorOutputSchema = z.object({
  intent: z.enum(['promise_to_pay', 'extension_request', 'partial_payment', 'dispute', 'other']),
  proposed_response: z.string().trim().min(5, 'Response is required'),
  proposed_terms: z
    .object({
      extension_days: z.number().int().min(0).optional().nullable(),
      new_due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').optional().nullable(),
      discount_pct: z.number().min(0).max(100).optional().nullable(),
      partial_amount: z.number().min(0).optional().nullable(),
      promised_date: z.string().optional().nullable(),
    })
    .default({}),
  escalate: z.boolean(),
  escalation_reason: z.string().optional().nullable(),
  reasoning: z.string(),
});
