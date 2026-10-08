import { describe, it, expect, beforeEach, vi } from 'vitest';
import { runReconciler } from './reconciler.js';

vi.mock('../config/db.js', () => {
  const query = vi.fn();
  return { query };
});

vi.mock('../services/scoring.js', () => {
  return {
    recomputeClientScore: vi.fn().mockResolvedValue({ avg_days_late: 0, on_time_rate: 95, risk_score: 12 }),
  };
});

import * as db from '../config/db.js';
import * as scoring from '../services/scoring.js';

const { query } = db;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Reconciler Agent (agents/reconciler.js)', () => {
  const userId = 'u1';
  const invoiceId = '11111111-1111-1111-1111-111111111111';

  it('closes pending approvals when invoice reaches status "paid"', async () => {
    query.mockImplementation(async (text) => {
      if (/from invoices i\s+join clients c/i.test(text)) {
        return {
          rowCount: 1,
          rows: [{ id: invoiceId, invoice_no: 'INV-1001', amount: 50000, paid_amount: 50000, client_id: 'c1', client_name: 'Acme Corp' }],
        };
      }
      if (/update approvals/i.test(text)) {
        return { rowCount: 1, rows: [{ id: 'app1' }] }; // 1 pending approval closed
      }
      if (/update communications/i.test(text) || /insert into agent_logs/i.test(text)) {
        return { rowCount: 1, rows: [] };
      }
      return { rows: [] };
    });

    const result = await runReconciler({
      userId,
      invoiceId,
      paymentAmount: 50000,
      newStatus: 'paid',
    });

    expect(result.newStatus).toBe('paid');
    expect(result.closedApprovalsCount).toBe(1);
    expect(scoring.recomputeClientScore).toHaveBeenCalledWith('c1');
  });

  it('records partial reconciliation and updates client score without closing approvals', async () => {
    query.mockImplementation(async (text) => {
      if (/from invoices i\s+join clients c/i.test(text)) {
        return {
          rowCount: 1,
          rows: [{ id: invoiceId, invoice_no: 'INV-1001', amount: 50000, paid_amount: 20000, client_id: 'c1', client_name: 'Acme Corp' }],
        };
      }
      if (/insert into agent_logs/i.test(text)) {
        return { rowCount: 1, rows: [] };
      }
      return { rows: [] };
    });

    const result = await runReconciler({
      userId,
      invoiceId,
      paymentAmount: 20000,
      newStatus: 'partial',
    });

    expect(result.newStatus).toBe('partial');
    expect(result.closedApprovalsCount).toBe(0);
    expect(scoring.recomputeClientScore).toHaveBeenCalledWith('c1');
  });
});
