import { describe, it, expect } from 'vitest';
import { validateDraft, validateNegotiatorTermsConsistency } from './validators.js';

describe('Draft & Negotiator Validators (services/validators.js)', () => {
  const invoice = {
    invoice_no: 'INV-1001',
    amount: 25000,
    paid_amount: 5000, // Remaining balance = 20000
    due_date: '2026-03-01',
  };
  const client = { name: 'Acme Corp' };
  const user = { name: 'Demo Owner', business_name: 'Demo Studio' };

  it('passes validation when real invoice number and accurate balance are included', () => {
    const draft = {
      subject: 'Payment reminder for invoice INV-1001',
      body: 'Hi Acme Corp, just a reminder that invoice INV-1001 with remaining balance of ₹20,000 was due on 2026-03-01. Regards, Demo Studio',
    };

    const result = validateDraft({ ...draft, invoice, client, user });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects draft if invoice number is missing', () => {
    const draft = {
      subject: 'Payment reminder for your account',
      body: 'Hi Acme Corp, please pay the outstanding balance of ₹20,000 as soon as possible.',
    };

    const result = validateDraft({ ...draft, invoice, client, user });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/missing required invoice number/i);
  });

  it('rejects draft if invoice amount/balance is completely missing', () => {
    const draft = {
      subject: 'Payment reminder for invoice INV-1001',
      body: 'Hi Acme Corp, please pay invoice INV-1001 which was due on 2026-03-01.',
    };

    const result = validateDraft({ ...draft, invoice, client, user });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/missing accurate invoice amount/i);
  });

  it('rejects draft if it contains hallucinated ungrounded monetary figures', () => {
    const draft = {
      subject: 'Invoice INV-1001 balance ₹20,000',
      body: 'Hi Acme Corp, you have invoice INV-1001 for ₹20,000 and an additional penalty of ₹9,999.',
    };

    const result = validateDraft({ ...draft, invoice, client, user });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('ungrounded monetary figure'))).toBe(true);
  });

  describe('validateNegotiatorTermsConsistency', () => {
    it('passes when text extension matches structured terms', () => {
      const res = validateNegotiatorTermsConsistency({
        proposed_response: 'We have approved a 7-day extension on invoice INV-1001.',
        proposed_terms: { extension_days: 7 },
      });
      expect(res.valid).toBe(true);
    });

    it('rejects when text mentions a different contradictory extension number', () => {
      const res = validateNegotiatorTermsConsistency({
        proposed_response: 'We have approved a 14-day extension on invoice INV-1001.',
        proposed_terms: { extension_days: 7 }, // Terms say 7, text says 14
      });
      expect(res.valid).toBe(false);
      expect(res.errors[0]).toMatch(/does not state the approved 7-day extension/i);
      expect(res.errors.some((e) => e.includes('Contradictory extension days'))).toBe(true);
    });
  });
});
