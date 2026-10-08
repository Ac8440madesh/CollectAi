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

const { query, pool } = db;
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

describe('Invoices API (/api/invoices)', () => {
  it('GET /api/invoices returns user-scoped invoices with client names', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ count: '1' }] })
      .mockResolvedValueOnce({
        rows: [{ id: 'inv1', invoice_no: 'INV-101', amount: 50000, client_name: 'Acme' }],
      });

    const res = await request(app).get('/api/invoices').set(authHeader('u1'));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].invoice_no).toBe('INV-101');
    expect(query).toHaveBeenCalledWith(
      expect.stringMatching(/where i\.user_id = \$1/i),
      expect.arrayContaining(['u1']),
    );
  });

  it('POST /api/invoices verifies client ownership and creates invoice', async () => {
    const clientId = '11111111-1111-1111-1111-111111111111';
    // Client ownership check
    query.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: clientId }] });
    // Insert invoice
    query.mockResolvedValueOnce({
      rows: [
        {
          id: 'inv1',
          user_id: 'u1',
          client_id: clientId,
          invoice_no: 'INV-201',
          amount: 25000,
          status: 'pending',
        },
      ],
    });

    const res = await request(app)
      .post('/api/invoices')
      .set(authHeader('u1'))
      .send({
        client_id: clientId,
        invoice_no: 'INV-201',
        amount: 25000,
        currency: 'INR',
        issue_date: '2026-03-01',
        due_date: '2026-03-31',
        status: 'pending',
      });

    expect(res.status).toBe(201);
    expect(res.body.invoice_no).toBe('INV-201');
  });

  it('POST /api/invoices returns 404 if client does not belong to user', async () => {
    const clientId = '11111111-1111-1111-1111-111111111111';
    query.mockResolvedValueOnce({ rowCount: 0, rows: [] });

    const res = await request(app)
      .post('/api/invoices')
      .set(authHeader('u1'))
      .send({
        client_id: clientId,
        invoice_no: 'INV-201',
        amount: 25000,
        currency: 'INR',
        issue_date: '2026-03-01',
        due_date: '2026-03-31',
      });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('POST /api/invoices/import imports CSV rows matching existing clients', async () => {
    // 1. Fetch user's clients
    query.mockResolvedValueOnce({
      rows: [{ id: '11111111-1111-1111-1111-111111111111', lname: 'acme corp' }],
    });

    // 2. Transaction queries in pool.connect()
    clientQuery.mockImplementation(async (text) => {
      if (/begin|commit|rollback/i.test(text)) return {};
      if (/insert into invoices/i.test(text)) return { rowCount: 1, rows: [{ id: 'new-inv' }] };
      return { rows: [], rowCount: 0 };
    });

    const csvContent = 'client_name,invoice_no,amount,issue_date,due_date\nAcme Corp,INV-CSV-1,15000,2026-02-01,2026-03-01';

    const res = await request(app)
      .post('/api/invoices/import')
      .set(authHeader('u1'))
      .attach('file', Buffer.from(csvContent), 'invoices.csv');

    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(1);
    expect(res.body.invoices).toContain('INV-CSV-1');
  });
});
