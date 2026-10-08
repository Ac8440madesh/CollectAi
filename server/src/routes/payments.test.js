import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

vi.mock('../config/db.js', () => {
  const query = vi.fn();
  const clientQuery = vi.fn();
  const pool = {
    query,
    connect: vi.fn(),
  };
  return { query, pool, __clientQuery: clientQuery };
});

import * as db from '../config/db.js';
import { createApp } from '../app.js';

const { pool } = db;
const clientQuery = db.__clientQuery;
const app = createApp();
const JWT_SECRET = process.env.JWT_SECRET;

function authHeader(userId = 'u1') {
  const token = jwt.sign({ sub: userId, email: `${userId}@example.com` }, JWT_SECRET, { expiresIn: '1h' });
  return { Authorization: `Bearer ${token}` };
}

beforeEach(() => {
  vi.clearAllMocks();
  const client = { query: clientQuery, release: vi.fn() };
  pool.connect.mockResolvedValue(client);
});

describe('Payments API (/api/payments)', () => {
  const invoiceId = '11111111-1111-1111-1111-111111111111';

  it('locks the invoice row with SELECT ... FOR UPDATE inside a transaction to prevent race conditions', async () => {
    let selectQueryText = '';
    clientQuery.mockImplementation(async (text) => {
      if (/begin|commit|rollback/i.test(text)) return {};
      if (/select.*from invoices/i.test(text)) {
        selectQueryText = text;
        return { rowCount: 1, rows: [{ id: invoiceId, amount: '50000', paid_amount: '0', status: 'pending' }] };
      }
      if (/insert into payments/i.test(text)) {
        return { rowCount: 1, rows: [{ id: 'pay1', invoice_id: invoiceId, amount: 20000, method: 'upi' }] };
      }
      if (/update invoices set paid_amount/i.test(text)) {
        return { rowCount: 1, rows: [] };
      }
      return { rows: [] };
    });

    await request(app)
      .post('/api/payments')
      .set(authHeader('u1'))
      .send({
        invoice_id: invoiceId,
        amount: 20000,
        method: 'upi',
      });

    expect(selectQueryText.toLowerCase()).toContain('for update');
  });

  it('POST /api/payments records partial payment and updates invoice to "partial"', async () => {
    clientQuery.mockImplementation(async (text) => {
      if (/begin|commit|rollback/i.test(text)) return {};
      if (/select id, amount, paid_amount, status from invoices/i.test(text)) {
        return { rowCount: 1, rows: [{ id: invoiceId, amount: '50000', paid_amount: '0', status: 'pending' }] };
      }
      if (/insert into payments/i.test(text)) {
        return { rowCount: 1, rows: [{ id: 'pay1', invoice_id: invoiceId, amount: 20000, method: 'upi' }] };
      }
      if (/update invoices set paid_amount/i.test(text)) {
        return { rowCount: 1, rows: [] };
      }
      return { rows: [] };
    });

    const res = await request(app)
      .post('/api/payments')
      .set(authHeader('u1'))
      .send({
        invoice_id: invoiceId,
        amount: 20000,
        method: 'upi',
      });

    expect(res.status).toBe(201);
    expect(res.body.invoice.status).toBe('partial');
    expect(res.body.invoice.paid_amount).toBe(20000);
  });

  it('POST /api/payments marks invoice as "paid" when full remaining balance is settled', async () => {
    clientQuery.mockImplementation(async (text) => {
      if (/begin|commit|rollback/i.test(text)) return {};
      if (/select id, amount, paid_amount, status from invoices/i.test(text)) {
        return { rowCount: 1, rows: [{ id: invoiceId, amount: '50000', paid_amount: '20000', status: 'partial' }] };
      }
      if (/insert into payments/i.test(text)) {
        return { rowCount: 1, rows: [{ id: 'pay2', invoice_id: invoiceId, amount: 30000, method: 'bank' }] };
      }
      if (/update invoices set paid_amount/i.test(text)) {
        return { rowCount: 1, rows: [] };
      }
      return { rows: [] };
    });

    const res = await request(app)
      .post('/api/payments')
      .set(authHeader('u1'))
      .send({
        invoice_id: invoiceId,
        amount: 30000,
        method: 'bank',
      });

    expect(res.status).toBe(201);
    expect(res.body.invoice.status).toBe('paid');
    expect(res.body.invoice.paid_amount).toBe(50000);
  });

  it('POST /api/payments rejects payment larger than remaining balance (400 EXCEEDS_BALANCE)', async () => {
    clientQuery.mockImplementation(async (text) => {
      if (/begin|commit|rollback/i.test(text)) return {};
      if (/select id, amount, paid_amount, status from invoices/i.test(text)) {
        return { rowCount: 1, rows: [{ id: invoiceId, amount: '50000', paid_amount: '35000', status: 'partial' }] };
      }
      return { rows: [] };
    });

    const res = await request(app)
      .post('/api/payments')
      .set(authHeader('u1'))
      .send({
        invoice_id: invoiceId,
        amount: 20000, // Remaining balance is only 15000
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('EXCEEDS_BALANCE');
    expect(res.body.error.message).toMatch(/exceeds remaining balance/i);
  });

  it('POST /api/payments rejects payment on already fully paid invoice (400 INVOICE_ALREADY_PAID)', async () => {
    clientQuery.mockImplementation(async (text) => {
      if (/begin|commit|rollback/i.test(text)) return {};
      if (/select id, amount, paid_amount, status from invoices/i.test(text)) {
        return { rowCount: 1, rows: [{ id: invoiceId, amount: '50000', paid_amount: '50000', status: 'paid' }] };
      }
      return { rows: [] };
    });

    const res = await request(app)
      .post('/api/payments')
      .set(authHeader('u1'))
      .send({
        invoice_id: invoiceId,
        amount: 5000,
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVOICE_ALREADY_PAID');
  });

  it('POST /api/payments rejects negative or zero amount with 400 VALIDATION_ERROR', async () => {
    const resNegative = await request(app)
      .post('/api/payments')
      .set(authHeader('u1'))
      .send({
        invoice_id: invoiceId,
        amount: -500,
      });

    expect(resNegative.status).toBe(400);
    expect(resNegative.body.error.code).toBe('VALIDATION_ERROR');

    const resZero = await request(app)
      .post('/api/payments')
      .set(authHeader('u1'))
      .send({
        invoice_id: invoiceId,
        amount: 0,
      });

    expect(resZero.status).toBe(400);
    expect(resZero.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('POST /api/payments returns 404 if invoice does not belong to user', async () => {
    clientQuery.mockImplementation(async (text) => {
      if (/begin|commit|rollback/i.test(text)) return {};
      if (/select id, amount, paid_amount, status from invoices/i.test(text)) {
        return { rowCount: 0, rows: [] };
      }
      return { rows: [] };
    });

    const res = await request(app)
      .post('/api/payments')
      .set(authHeader('u1'))
      .send({
        invoice_id: invoiceId,
        amount: 10000,
      });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
