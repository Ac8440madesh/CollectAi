import { z } from 'zod';

// ── Clients ──────────────────────────────────────────────────────────────────

export const createClientSchema = z.object({
  name: z.string().trim().min(1, 'Client name is required').max(200),
  email: z.string().trim().toLowerCase().email().max(254).optional().nullable(),
  phone: z.string().trim().max(20).optional().nullable(),
  payment_terms_days: z.coerce.number().int().min(1).max(365).default(30),
  notes: z.string().max(2000).optional().nullable(),
});

export const updateClientSchema = createClientSchema.partial();

export const clientIdParam = z.object({
  id: z.string().uuid('Invalid client ID'),
});

// ── Invoices ─────────────────────────────────────────────────────────────────

export const createInvoiceSchema = z.object({
  client_id: z.string().uuid('Invalid client ID'),
  invoice_no: z.string().trim().min(1, 'Invoice number is required').max(50),
  amount: z.coerce.number().positive('Amount must be positive'),
  currency: z.string().trim().toUpperCase().max(3).default('INR'),
  issue_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),
  status: z.enum(['pending', 'overdue', 'partial', 'paid', 'disputed']).default('pending'),
  paid_amount: z.coerce.number().min(0).default(0),
});

export const updateInvoiceSchema = createInvoiceSchema
  .omit({ client_id: true })
  .partial();

export const invoiceIdParam = z.object({
  id: z.string().uuid('Invalid invoice ID'),
});

// ── Payments ─────────────────────────────────────────────────────────────────

export const createPaymentSchema = z.object({
  invoice_id: z.string().uuid('Invalid invoice ID'),
  amount: z.coerce.number().positive('Amount must be positive'),
  paid_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').optional(),
  method: z.string().trim().max(40).optional().nullable(),
  reference: z.string().trim().max(100).optional().nullable(),
});

// ── Policies ─────────────────────────────────────────────────────────────────

export const updatePolicySchema = z.object({
  max_extension_days: z.coerce.number().int().min(1).max(180).optional(),
  max_discount_pct: z.coerce.number().min(0).max(100).optional(),
  min_partial_pct: z.coerce.number().min(0).max(100).optional(),
  approval_amount_threshold: z.coerce.number().min(0).optional(),
  dry_run: z.boolean().optional(),
});

// ── Approvals ────────────────────────────────────────────────────────────────

export const approvalIdParam = z.object({
  id: z.string().uuid('Invalid approval ID'),
});

export const decideApprovalSchema = z.object({
  decision: z.enum(['approve', 'reject', 'edit_and_approve']),
  edited_subject: z.string().trim().min(3).max(200).optional(),
  edited_body: z.string().trim().min(10).max(4000).optional(),
});

// ── Inbound Communications ───────────────────────────────────────────────────

export const inboundMessageSchema = z.object({
  invoice_id: z.string().uuid('Invalid invoice ID'),
  client_message: z
    .string()
    .trim()
    .min(1, 'Client message is required')
    .max(2000, 'Message cannot exceed 2000 characters'),
  channel: z.enum(['email', 'whatsapp', 'sms']).default('email'),
});

// ── Query helpers ────────────────────────────────────────────────────────────

export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  status: z.enum(['pending', 'overdue', 'partial', 'paid', 'disputed']).optional(),
  search: z.string().max(100).optional(),
});
