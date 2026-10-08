import { describe, it, expect, beforeEach, vi } from 'vitest';
import { checkApprovalGate, checkClientRateLimit, checkBusinessHours } from './guardrails.js';

vi.mock('../config/db.js', () => {
  const query = vi.fn();
  return { query };
});

import * as db from '../config/db.js';
const { query } = db;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Guardrails Service (services/guardrails.js)', () => {
  describe('checkApprovalGate', () => {
    const policy = { approval_amount_threshold: 50000 };

    it('requires approval when invoice amount exceeds policy threshold', () => {
      const invoice = { invoice_no: 'INV-BIG', amount: 75000, status: 'overdue' };
      const rec = { tone: 'firm', reasoning: 'Late payment', should_escalate: false };

      const result = checkApprovalGate({ invoice, policy, recommendation: rec });
      expect(result.needsApproval).toBe(true);
      expect(result.reason).toMatch(/exceeds approval threshold/i);
    });

    it('auto-passes approval gate when amount is within threshold and healthy', () => {
      const invoice = { invoice_no: 'INV-SMALL', amount: 25000, status: 'overdue' };
      const rec = { tone: 'friendly', reasoning: 'First reminder', should_escalate: false };

      const result = checkApprovalGate({ invoice, policy, recommendation: rec });
      expect(result.needsApproval).toBe(false);
    });

    it('requires approval when invoice status is "disputed"', () => {
      const invoice = { invoice_no: 'INV-DISP', amount: 15000, status: 'disputed' };
      const rec = { tone: 'dispute_resolution', reasoning: 'Client disputed', should_escalate: true };

      const result = checkApprovalGate({ invoice, policy, recommendation: rec });
      expect(result.needsApproval).toBe(true);
      expect(result.reason).toMatch(/marked as disputed/i);
    });

    it('requires approval when Analyst flags should_escalate = true', () => {
      const invoice = { invoice_no: 'INV-RISK', amount: 30000, status: 'overdue' };
      const rec = { tone: 'final', reasoning: 'Client risk score > 80', should_escalate: true };

      const result = checkApprovalGate({ invoice, policy, recommendation: rec });
      expect(result.needsApproval).toBe(true);
      expect(result.reason).toMatch(/Analyst recommended human escalation/i);
    });

    it('evaluates combined total amount for a group of invoices against threshold', () => {
      const invoices = [
        { invoice_no: 'INV-A', amount: 30000, status: 'overdue' },
        { invoice_no: 'INV-B', amount: 30000, status: 'overdue' },
      ]; // Total = 60,000 > 50,000 threshold

      const result = checkApprovalGate({ invoices, policy, recommendation: { tone: 'firm' } });
      expect(result.needsApproval).toBe(true);
      expect(result.reason).toMatch(/Total invoice amount \(₹60,000\) for INV-A, INV-B exceeds approval threshold/i);
    });
  });

  describe('checkClientRateLimit', () => {
    it('returns rateLimited: true ONLY if a reminder was actually sent (status: sent) within 3 days', async () => {
      query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ created_at: new Date().toISOString(), subject: 'Past Sent Reminder' }],
      });

      const result = await checkClientRateLimit('c1');
      expect(result.rateLimited).toBe(true);
      expect(result.reason).toMatch(/already sent a reminder/i);
      expect(query).toHaveBeenCalledWith(
        expect.stringMatching(/and c\.status = 'sent'/i),
        ['c1'],
      );
    });

    it('returns rateLimited: false if no communications have been sent to client recently', async () => {
      query.mockResolvedValueOnce({ rowCount: 0, rows: [] });

      const result = await checkClientRateLimit('c1');
      expect(result.rateLimited).toBe(false);
    });
  });

  describe('checkBusinessHours (Asia/Kolkata)', () => {
    it('accurately converts UTC to Asia/Kolkata IST and verifies business hours (9 AM - 6 PM)', () => {
      // Wednesday 06:00 UTC = Wednesday 11:30 AM IST (Within business hours)
      const wednesdayMorningUTC = new Date('2026-03-04T06:00:00.000Z');
      const res = checkBusinessHours(wednesdayMorningUTC, false);
      expect(res.timezone).toBe('Asia/Kolkata');
      expect(res.weekdayIST).toBe('Wed');
      expect(res.hourIST).toBe(11);
      expect(res.isWeekday).toBe(true);
      expect(res.isBusinessHours).toBe(true);

      // Wednesday 15:00 UTC = Wednesday 8:30 PM (20:30) IST (Outside business hours)
      const wednesdayNightUTC = new Date('2026-03-04T15:00:00.000Z');
      const resNight = checkBusinessHours(wednesdayNightUTC, false);
      expect(resNight.hourIST).toBe(20);
      expect(resNight.isBusinessHours).toBe(false);

      // Saturday 06:00 UTC = Saturday 11:30 AM IST (Weekend, outside business hours)
      const saturdayUTC = new Date('2026-03-07T06:00:00.000Z');
      const resSat = checkBusinessHours(saturdayUTC, false);
      expect(resSat.isWeekday).toBe(false);
      expect(resSat.isBusinessHours).toBe(false);
    });

    it('bypasses business hours restriction when dryRun is true', () => {
      // Midnight on Sunday in dry-run mode
      const sundayMidnight = new Date('2026-03-01T19:00:00.000Z');
      const res = checkBusinessHours(sundayMidnight, true);
      expect(res.isBusinessHours).toBe(true);
      expect(res.dryRunBypass).toBe(true);
    });
  });
});
