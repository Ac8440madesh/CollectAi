import { describe, it, expect, beforeEach, vi } from 'vitest';
import { recomputeClientScore, computeScores, roundHalfUp, EXTENSION_ON_TIME_CREDIT } from './scoring.js';

vi.mock('../config/db.js', () => {
  const query = vi.fn();
  return { query };
});

import * as db from '../config/db.js';
const { query } = db;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Client Scoring Service (services/scoring.js)', () => {
  const clientId = 'c1';

  it('exports EXTENSION_ON_TIME_CREDIT as 0.75', () => {
    expect(EXTENSION_ON_TIME_CREDIT).toBe(0.75);
  });

  it('roundHalfUp rounds halves toward +Infinity (39.5 -> 40, 72.5 -> 73)', () => {
    expect(roundHalfUp(39.5)).toBe(40);
    expect(roundHalfUp(72.5)).toBe(73);
    expect(roundHalfUp(39.495)).toBe(39);
  });

  describe('computeScores (pure function)', () => {
    it('scores 100% on-time and risk 0 when paid on or before original due date', () => {
      const result = computeScores([
        { invoice_no: 'INV-1', amount: 25000, due_date: '2026-03-01', extended_due_date: null, status: 'paid', latest_payment_date: '2026-02-28' },
      ]);
      expect(result.on_time_rate).toBe(100);
      expect(result.avg_days_late).toBe(0);
      expect(result.risk_score).toBe(0);
    });

    it('awards 75% credit when paid within agreed extension', () => {
      const result = computeScores([
        { invoice_no: 'INV-1', amount: 25000, due_date: '2026-03-01', extended_due_date: '2026-03-15', status: 'paid', latest_payment_date: '2026-03-08' },
      ]);
      expect(result.on_time_rate).toBe(75);
      expect(result.avg_days_late).toBe(0);
      expect(result.unrounded_risk).toBe(12.5);
      expect(result.risk_score).toBe(13); // roundHalfUp(12.5) = 13
    });

    it('matches the Acme demo scenario exactly (unrounded 39.495 -> 39)', () => {
      // 3 paid invoices: 2 paid 2 days late (0 credit), 1 paid within extension (0.75 credit)
      const result = computeScores([
        { invoice_no: 'INV-1001', amount: 25000, due_date: '2026-09-08', extended_due_date: null, status: 'paid', latest_payment_date: '2026-09-10' },
        { invoice_no: 'INV-1002', amount: 18000, due_date: '2026-10-03', extended_due_date: '2026-10-15', status: 'paid', latest_payment_date: '2026-10-08' },
        { invoice_no: 'INV-1003', amount: 32000, due_date: '2026-08-09', extended_due_date: null, status: 'paid', latest_payment_date: '2026-08-11' },
      ]);
      expect(result.on_time_rate).toBe(25); // (0 + 0.75 + 0) / 3 = 0.25
      expect(result.avg_days_late).toBe(1.33); // (2 + 0 + 2) / 3 = 1.333 -> 1.33
      expect(result.unrounded_risk).toBeCloseTo(39.495, 3); // 37.5 + 1.995
      expect(result.risk_score).toBe(39); // roundHalfUp(39.495) = 39
    });

    it('matches the Globex demo scenario exactly (unrounded 72.5 -> 73)', () => {
      // 1 paid invoice: paid 15 days late past extension (0 credit)
      const result = computeScores([
        { invoice_no: 'INV-2001', amount: 54000, due_date: '2026-09-08', extended_due_date: '2026-09-23', status: 'paid', latest_payment_date: '2026-10-08' },
      ]);
      expect(result.on_time_rate).toBe(0);
      expect(result.avg_days_late).toBe(15);
      expect(result.unrounded_risk).toBe(72.5); // 50 + 22.5
      expect(result.risk_score).toBe(73); // roundHalfUp(72.5) = 73
    });

    it('scores 0% and 15 days late when paid late with no extension', () => {
      const result = computeScores([
        { invoice_no: 'INV-1', amount: 25000, due_date: '2026-03-01', extended_due_date: null, status: 'paid', latest_payment_date: '2026-03-16' },
      ]);
      expect(result.on_time_rate).toBe(0);
      expect(result.avg_days_late).toBe(15);
      expect(result.risk_score).toBe(73); // 50 + 22.5 = 72.5 -> 73
    });

    it('EXCLUDES partial/overdue invoices from on-time rate but raises risk via overdue penalty', () => {
      const result = computeScores([
        { invoice_no: 'INV-1', amount: 50000, due_date: '2026-03-01', extended_due_date: null, status: 'paid', latest_payment_date: '2026-02-28' },
        { invoice_no: 'INV-2', amount: 40000, due_date: '2026-03-01', extended_due_date: null, status: 'partial', latest_payment_date: '2026-02-15' },
      ]);
      // Only INV-1 counts toward on-time rate
      expect(result.paid_count).toBe(1);
      expect(result.on_time_rate).toBe(100);
      // INV-2 (partial) adds +10 overdue penalty
      expect(result.overdue_count).toBe(1);
      expect(result.risk_score).toBe(10);
    });
  });

  it('recomputeClientScore persists computed scores to client_scores', async () => {
    query.mockImplementation(async (text) => {
      if (/from invoices i/i.test(text)) {
        return {
          rowCount: 1,
          rows: [
            { invoice_no: 'INV-1', amount: 25000, due_date: '2026-03-01', extended_due_date: null, status: 'paid', latest_payment_date: '2026-02-28' },
          ],
        };
      }
      return { rows: [] };
    });

    const score = await recomputeClientScore(clientId);
    expect(score.on_time_rate).toBe(100);
    expect(score.risk_score).toBe(0);
    expect(query).toHaveBeenCalledWith(
      expect.stringMatching(/insert into client_scores/i),
      expect.arrayContaining([clientId]),
    );
  });
});
