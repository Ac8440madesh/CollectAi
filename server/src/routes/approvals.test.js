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

describe('Approvals API (/api/approvals)', () => {
  const approvalId = '11111111-1111-1111-1111-111111111111';

  it('GET /api/approvals returns user-scoped pending approval items', async () => {
    query.mockResolvedValueOnce({
      rowCount: 1,
      rows: [
        {
          id: approvalId,
          user_id: 'u1',
          invoice_no: 'INV-5002',
          invoice_amount: 220000,
          reason: 'Amount exceeds threshold',
          status: 'pending',
          client_name: 'Wayne Enterprises',
        },
      ],
    });

    const res = await request(app).get('/api/approvals').set(authHeader('u1'));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].invoice_no).toBe('INV-5002');
    expect(query).toHaveBeenCalledWith(
      expect.stringMatching(/where a\.user_id = \$1 and a\.status = 'pending'/i),
      ['u1'],
    );
  });

  it('POST /api/approvals/:id/decide locks approval row with SELECT ... FOR UPDATE on dedicated client', async () => {
    let selectQueryText = '';
    clientQuery.mockImplementation(async (text) => {
      if (/begin|commit|rollback/i.test(text)) return {};
      if (/select a\.\*.*from approvals/is.test(text)) {
        selectQueryText = text;
        return {
          rowCount: 1,
          rows: [
            {
              id: approvalId,
              user_id: 'u1',
              status: 'pending',
              invoice_no: 'INV-5002',
              invoice_amount: 220000,
              paid_amount: 0,
              client_email: 'ap@wayne.example',
              comm_id: 'c1',
            },
          ],
        };
      }
      if (/select dry_run from policies/i.test(text)) {
        return { rows: [{ dry_run: true }] };
      }
      if (/update communications/i.test(text) || /update approvals/i.test(text) || /insert into agent_logs/i.test(text)) {
        return { rowCount: 1, rows: [] };
      }
      return { rows: [] };
    });

    await request(app)
      .post(`/api/approvals/${approvalId}/decide`)
      .set(authHeader('u1'))
      .send({ decision: 'approve' });

    expect(selectQueryText.toLowerCase()).toContain('for update');
  });

  it('POST /api/approvals/:id/decide approves and records "sent (dry run)" without SMTP', async () => {
    clientQuery.mockImplementation(async (text) => {
      if (/begin|commit|rollback/i.test(text)) return {};
      if (/select a\.\*.*from approvals/is.test(text)) {
        return {
          rowCount: 1,
          rows: [
            {
              id: approvalId,
              user_id: 'u1',
              status: 'pending',
              invoice_no: 'INV-5002',
              invoice_amount: 220000,
              paid_amount: 0,
              client_email: 'ap@wayne.example',
              comm_id: 'c1',
              comm_subject: 'Payment Reminder INV-5002',
              comm_body: 'Please pay invoice INV-5002 for ₹2,20,000.',
            },
          ],
        };
      }
      if (/select dry_run from policies/i.test(text)) {
        return { rows: [{ dry_run: true }] };
      }
      if (/update communications/i.test(text) || /update approvals/i.test(text) || /insert into agent_logs/i.test(text)) {
        return { rowCount: 1, rows: [] };
      }
      return { rows: [] };
    });

    const res = await request(app)
      .post(`/api/approvals/${approvalId}/decide`)
      .set(authHeader('u1'))
      .send({ decision: 'approve' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('approved');
    expect(res.body.mailResult.dry_run).toBe(true);
    expect(res.body.mailResult.delivery_status).toBe('sent (dry run)');
  });

  it('POST /api/approvals/:id/decide rejects approval and sends nothing', async () => {
    clientQuery.mockImplementation(async (text) => {
      if (/begin|commit|rollback/i.test(text)) return {};
      if (/select a\.\*.*from approvals/is.test(text)) {
        return {
          rowCount: 1,
          rows: [
            {
              id: approvalId,
              user_id: 'u1',
              status: 'pending',
              invoice_no: 'INV-5002',
              comm_id: 'c1',
              reason: 'High value',
            },
          ],
        };
      }
      if (/update approvals/i.test(text) || /update communications/i.test(text) || /insert into agent_logs/i.test(text)) {
        return { rowCount: 1, rows: [] };
      }
      return { rows: [] };
    });

    const res = await request(app)
      .post(`/api/approvals/${approvalId}/decide`)
      .set(authHeader('u1'))
      .send({ decision: 'reject' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('rejected');
    expect(res.body.mailResult).toBeUndefined(); // Nothing was sent
  });

  it('POST /api/approvals/:id/decide rejects double decision with 400 ALREADY_DECIDED', async () => {
    clientQuery.mockImplementation(async (text) => {
      if (/begin|commit|rollback/i.test(text)) return {};
      if (/select a\.\*.*from approvals/is.test(text)) {
        return {
          rowCount: 1,
          rows: [
            {
              id: approvalId,
              user_id: 'u1',
              status: 'approved', // already approved!
              invoice_no: 'INV-5002',
            },
          ],
        };
      }
      return { rows: [] };
    });

    const res = await request(app)
      .post(`/api/approvals/${approvalId}/decide`)
      .set(authHeader('u1'))
      .send({ decision: 'approve' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('ALREADY_DECIDED');
    expect(res.body.error.message).toMatch(/already been approved/i);
  });

  it('handles concurrent double-decide calls: only first succeeds, second gets 400 ALREADY_DECIDED', async () => {
    let callCount = 0;
    clientQuery.mockImplementation(async (text) => {
      if (/begin|commit|rollback/i.test(text)) return {};
      if (/select a\.\*.*from approvals/is.test(text)) {
        callCount++;
        // First call sees 'pending', second concurrent call sees 'approved' after first commits
        return {
          rowCount: 1,
          rows: [
            {
              id: approvalId,
              user_id: 'u1',
              status: callCount === 1 ? 'pending' : 'approved',
              invoice_no: 'INV-5002',
              invoice_amount: 220000,
              paid_amount: 0,
              client_email: 'ap@wayne.example',
              comm_id: 'c1',
            },
          ],
        };
      }
      if (/select dry_run from policies/i.test(text)) {
        return { rows: [{ dry_run: true }] };
      }
      if (/update communications/i.test(text) || /update approvals/i.test(text) || /insert into agent_logs/i.test(text)) {
        return { rowCount: 1, rows: [] };
      }
      return { rows: [] };
    });

    const [first, second] = await Promise.all([
      request(app).post(`/api/approvals/${approvalId}/decide`).set(authHeader('u1')).send({ decision: 'approve' }),
      request(app).post(`/api/approvals/${approvalId}/decide`).set(authHeader('u1')).send({ decision: 'approve' }),
    ]);

    expect(first.status).toBe(200);
    expect(first.body.status).toBe('approved');

    expect(second.status).toBe(400);
    expect(second.body.error.code).toBe('ALREADY_DECIDED');
  });

  it('POST /api/approvals/:id/decide validates edited text on edit_and_approve', async () => {
    clientQuery.mockImplementation(async (text) => {
      if (/begin|commit|rollback/i.test(text)) return {};
      if (/select a\.\*.*from approvals/is.test(text)) {
        return {
          rowCount: 1,
          rows: [
            {
              id: approvalId,
              user_id: 'u1',
              status: 'pending',
              invoice_no: 'INV-5002',
              invoice_amount: 220000,
              paid_amount: 0,
              client_name: 'Wayne Enterprises',
              client_email: 'ap@wayne.example',
              comm_id: 'c1',
            },
          ],
        };
      }
      if (/select dry_run from policies/i.test(text)) {
        return { rows: [{ dry_run: true }] };
      }
      if (/update communications/i.test(text) || /update approvals/i.test(text) || /insert into agent_logs/i.test(text)) {
        return { rowCount: 1, rows: [] };
      }
      return { rows: [] };
    });

    // Valid edit
    const res = await request(app)
      .post(`/api/approvals/${approvalId}/decide`)
      .set(authHeader('u1'))
      .send({
        decision: 'edit_and_approve',
        edited_subject: 'Custom Reminder for Invoice INV-5002',
        edited_body: 'Dear Wayne Enterprises, please find invoice INV-5002 for ₹2,20,000.',
      });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('approved');
  });

  it('enforces cross-user isolation (User B cannot decide User A approval)', async () => {
    clientQuery.mockImplementation(async (text) => {
      if (/begin|commit|rollback/i.test(text)) return {};
      if (/select a\.\*.*from approvals/is.test(text)) {
        return { rowCount: 0, rows: [] }; // Not found for user 'u2'
      }
      return { rows: [] };
    });

    const res = await request(app)
      .post(`/api/approvals/${approvalId}/decide`)
      .set(authHeader('u2'))
      .send({ decision: 'approve' });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
