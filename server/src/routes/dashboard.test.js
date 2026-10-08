import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

vi.mock('../config/db.js', () => {
  const query = vi.fn();
  return { query };
});

import * as db from '../config/db.js';
import { createApp } from '../app.js';

const { query } = db;
const app = createApp();
const JWT_SECRET = process.env.JWT_SECRET;

function authHeader(userId = 'u1') {
  const token = jwt.sign({ sub: userId, email: `${userId}@example.com` }, JWT_SECRET, { expiresIn: '1h' });
  return { Authorization: `Bearer ${token}` };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Dashboard API (/api/dashboard)', () => {
  it('GET /api/dashboard/summary returns KPIs, DSO trend, and 30/60/90-day forecast', async () => {
    const today = new Date();
    const in10Days = new Date(today.getTime() + 10 * 86400000).toISOString().slice(0, 10);
    const in40Days = new Date(today.getTime() + 40 * 86400000).toISOString().slice(0, 10);
    const in70Days = new Date(today.getTime() + 70 * 86400000).toISOString().slice(0, 10);

    query.mockImplementation(async (text) => {
      // 1. Receivables aggregate
      if (/coalesce\(sum.*outstanding/is.test(text)) {
        return {
          rows: [
            {
              outstanding: '180000',
              overdue: '75000',
              recovered: '120000',
              total_invoices: '14',
              count_pending: '4',
              count_overdue: '3',
              count_partial: '2',
              count_paid: '4',
              count_disputed: '1',
            },
          ],
        };
      }
      // 2. Autonomy rate query
      if (/count\(case when agent = 'communicator'/i.test(text)) {
        return {
          rows: [{ auto_sent_count: '8', approval_count: '2', total_actions: '10' }],
        };
      }
      // 3. Forecast query
      if (/from invoices i[\s\S]*client_scores cs/i.test(text)) {
        return {
          rows: [
            { id: 'inv1', remaining_balance: '50000', effective_due_date: in10Days, on_time_prob: '80' },
            { id: 'inv2', remaining_balance: '60000', effective_due_date: in40Days, on_time_prob: '60' },
            { id: 'inv3', remaining_balance: '70000', effective_due_date: in70Days, on_time_prob: '70' },
          ],
        };
      }
      // 4. Recent logs query
      if (/from agent_logs/i.test(text)) {
        return { rows: [{ id: 'log1', agent: 'monitor', reasoning: 'Scanned invoices' }] };
      }
      return { rows: [] };
    });

    const res = await request(app).get('/api/dashboard/summary').set(authHeader('u1'));

    expect(res.status).toBe(200);
    expect(res.body.metrics.outstanding).toBe(180000);
    expect(res.body.metrics.overdue).toBe(75000);
    expect(res.body.metrics.recovered).toBe(120000);
    expect(res.body.metrics.autonomy_rate).toBe(80); // (8 / 10) * 100 = 80%

    // DSO trend contains months & calculations
    expect(res.body.dso_trend).toBeInstanceOf(Array);
    expect(res.body.dso_trend.length).toBeGreaterThanOrEqual(5);

    // 30/60/90-Day Forecast
    expect(res.body.cash_flow_forecast.next_30_days).toBeGreaterThan(0);
    expect(res.body.cash_flow_forecast.forecast_chart).toHaveLength(3);
  });

  it('GET /api/dashboard/invoices/:id/timeline returns chronological history', async () => {
    const invoiceId = '11111111-1111-1111-1111-111111111111';

    query.mockImplementation(async (text) => {
      if (/select i\.\*.*from invoices/is.test(text)) {
        return {
          rowCount: 1,
          rows: [{ id: invoiceId, invoice_no: 'INV-101', amount: 50000, due_date: '2026-03-01', created_at: '2026-02-01' }],
        };
      }
      if (/from payments/i.test(text)) {
        return { rows: [{ id: 'p1', amount: 20000, paid_on: '2026-02-15', created_at: '2026-02-15' }] };
      }
      if (/from communications/i.test(text)) {
        return { rows: [{ id: 'c1', direction: 'outbound', status: 'sent', subject: 'Reminder', created_at: '2026-02-10' }] };
      }
      if (/from approvals/i.test(text) || /from agent_logs/i.test(text)) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    const res = await request(app).get(`/api/dashboard/invoices/${invoiceId}/timeline`).set(authHeader('u1'));

    expect(res.status).toBe(200);
    expect(res.body.events).toHaveLength(3); // created + payment + communication
    expect(res.body.events[0].type).toBe('invoice_created');
  });

  it('enforces cross-user isolation on timeline (404 for another user invoice)', async () => {
    query.mockResolvedValueOnce({ rowCount: 0, rows: [] });

    const res = await request(app).get('/api/dashboard/invoices/22222222-2222-2222-2222-222222222222/timeline').set(authHeader('u2'));

    expect(res.status).toBe(404);
  });
});
