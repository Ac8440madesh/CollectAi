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
  query.mockResolvedValue({ rowCount: 0, rows: [] });
});

describe('Communications API (/api/communications)', () => {
  const invoiceId = '11111111-1111-1111-1111-111111111111';

  it('POST /api/communications/inbound handles in-policy extension request autonomously and updates extended_due_date', async () => {
    let updateInvoiceSql = '';
    let updateParams = [];
    clientQuery.mockImplementation(async (text, params) => {
      if (/begin|commit|rollback/i.test(text)) return {};
      if (/select i\.\*.*from invoices/is.test(text)) {
        return {
          rowCount: 1,
          rows: [
            {
              id: invoiceId,
              client_id: 'c1',
              invoice_no: 'INV-1001',
              amount: 25000,
              paid_amount: 0,
              status: 'overdue',
              due_date: '2026-03-01',
              client_name: 'Acme Corp',
              client_email: 'acme@example.com',
            },
          ],
        };
      }
      if (/select name, business_name from users/i.test(text)) {
        return { rows: [{ name: 'Owner', business_name: 'Studio' }] };
      }
      if (/select \* from policies/i.test(text)) {
        return { rows: [{ max_extension_days: 14, max_discount_pct: 10, min_partial_pct: 25, dry_run: true }] };
      }
      if (/update invoices/i.test(text)) {
        updateInvoiceSql = text;
        updateParams = params;
        return { rowCount: 1, rows: [] };
      }
      if (/insert into communications/i.test(text)) {
        return { rowCount: 1, rows: [{ id: 'comm-1' }] };
      }
      if (/insert into agent_logs/i.test(text)) {
        return { rowCount: 1, rows: [] };
      }
      return { rows: [] };
    });

    query.mockImplementation(async (text) => {
      if (/insert into agent_logs/i.test(text)) return { rowCount: 1, rows: [] };
      return { rowCount: 0, rows: [] };
    });

    const res = await request(app)
      .post('/api/communications/inbound')
      .set(authHeader('u1'))
      .send({
        invoice_id: invoiceId,
        client_message: 'Hi, can we get a 7-day extension? We will pay next week.',
        channel: 'email',
      });

    expect(res.status).toBe(201);
    expect(res.body.negotiation.intent).toBe('extension_request');
    expect(res.body.negotiation.escalate).toBe(false);
    expect(res.body.approval_id).toBeNull();
    expect(updateInvoiceSql).toContain('extended_due_date');
    expect(updateParams[0]).toMatch(/^\d{4}-\d{2}-\d{2}$/); // Valid YYYY-MM-DD date stored
  });

  it('POST /api/communications/inbound creates approval item with kind = "dispute_review" when client disputes', async () => {
    let insertedKind = '';
    clientQuery.mockImplementation(async (text) => {
      if (/begin|commit|rollback/i.test(text)) return {};
      if (/select i\.\*.*from invoices/is.test(text)) {
        return {
          rowCount: 1,
          rows: [
            {
              id: invoiceId,
              client_id: 'c1',
              invoice_no: 'INV-1001',
              amount: 25000,
              paid_amount: 0,
              status: 'overdue',
              due_date: '2026-03-01',
              client_name: 'Acme Corp',
              client_email: 'acme@example.com',
            },
          ],
        };
      }
      if (/select name, business_name from users/i.test(text)) {
        return { rows: [{ name: 'Owner', business_name: 'Studio' }] };
      }
      if (/select \* from policies/i.test(text)) {
        return { rows: [{ max_extension_days: 14, max_discount_pct: 10, min_partial_pct: 25, dry_run: true }] };
      }
      if (/insert into communications/i.test(text)) {
        return { rowCount: 1, rows: [{ id: 'comm-1' }] };
      }
      if (/update communications/i.test(text) || /insert into agent_logs/i.test(text)) {
        return { rowCount: 1, rows: [] };
      }
      return { rows: [] };
    });

    query.mockImplementation(async (text, params) => {
      if (/select \* from approvals/i.test(text)) {
        return { rowCount: 0, rows: [] };
      }
      if (/insert into approvals/i.test(text)) {
        insertedKind = params[3]; // $4 = kind
        return { rowCount: 1, rows: [{ id: 'approval-disp-1', kind: insertedKind }] };
      }
      if (/insert into agent_logs/i.test(text) || /update communications/i.test(text)) {
        return { rowCount: 1, rows: [] };
      }
      return { rowCount: 0, rows: [] };
    });

    const res = await request(app)
      .post('/api/communications/inbound')
      .set(authHeader('u1'))
      .send({
        invoice_id: invoiceId,
        client_message: 'We are disputing this charge because deliverables were not delivered.',
        channel: 'email',
      });

    expect(res.status).toBe(201);
    expect(res.body.negotiation.intent).toBe('dispute');
    expect(res.body.negotiation.escalate).toBe(true);
    expect(insertedKind).toBe('dispute_review');
  });

  it('POST /api/communications/inbound queues out-of-policy extension (45 days) for human approval', async () => {
    clientQuery.mockImplementation(async (text) => {
      if (/begin|commit|rollback/i.test(text)) return {};
      if (/select i\.\*.*from invoices/is.test(text)) {
        return {
          rowCount: 1,
          rows: [
            {
              id: invoiceId,
              client_id: 'c1',
              invoice_no: 'INV-1001',
              amount: 25000,
              paid_amount: 0,
              status: 'overdue',
              due_date: '2026-03-01',
              client_name: 'Acme Corp',
              client_email: 'acme@example.com',
            },
          ],
        };
      }
      if (/select name, business_name from users/i.test(text)) {
        return { rows: [{ name: 'Owner', business_name: 'Studio' }] };
      }
      if (/select \* from policies/i.test(text)) {
        return { rows: [{ max_extension_days: 14, max_discount_pct: 10, min_partial_pct: 25, dry_run: true }] };
      }
      if (/insert into communications/i.test(text)) {
        return { rowCount: 1, rows: [{ id: 'comm-1' }] };
      }
      if (/update communications/i.test(text) || /insert into agent_logs/i.test(text)) {
        return { rowCount: 1, rows: [] };
      }
      return { rows: [] };
    });

    query.mockImplementation(async (text) => {
      if (/select \* from approvals/i.test(text)) {
        return { rowCount: 0, rows: [] };
      }
      if (/insert into approvals/i.test(text)) {
        return { rowCount: 1, rows: [{ id: 'approval-999', kind: 'escalation' }] };
      }
      if (/insert into agent_logs/i.test(text) || /update communications/i.test(text)) {
        return { rowCount: 1, rows: [] };
      }
      return { rowCount: 0, rows: [] };
    });

    const res = await request(app)
      .post('/api/communications/inbound')
      .set(authHeader('u1'))
      .send({
        invoice_id: invoiceId,
        client_message: 'We need a 45-day extension to pay.',
        channel: 'email',
      });

    expect(res.status).toBe(201);
    expect(res.body.negotiation.escalate).toBe(true);
    expect(res.body.approval_id).toBe('approval-999');
  });

  it('enforces cross-user isolation (User B cannot submit inbound message for User A invoice)', async () => {
    clientQuery.mockImplementation(async (text) => {
      if (/begin|commit|rollback/i.test(text)) return {};
      if (/select i\.\*.*from invoices/is.test(text)) {
        return { rowCount: 0, rows: [] }; // Not found for user 'u2'
      }
      return { rows: [] };
    });

    const res = await request(app)
      .post('/api/communications/inbound')
      .set(authHeader('u2'))
      .send({
        invoice_id: invoiceId,
        client_message: 'Hi there',
      });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
