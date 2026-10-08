import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

vi.mock('../config/db.js', () => {
  const query = vi.fn();
  const pool = { query, connect: vi.fn() };
  return { query, pool };
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

const ORIGINAL_ENV = process.env;

beforeEach(() => {
  vi.clearAllMocks();
  process.env = { ...ORIGINAL_ENV };
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
});

describe('Agents API (/api/agents)', () => {
  it('POST /api/agents/run executes Phase 3 & 4 pipeline with client grouping, approval gating, and dispute resolution', async () => {
    query.mockImplementation(async (text) => {
      // 1. Fetch user info
      if (/from users where id/i.test(text)) {
        return { rows: [{ id: 'u1', name: 'Demo Owner', email: 'demo@collectai.app', business_name: 'Studio' }] };
      }
      // 2. Fetch policy
      if (/from policies where user_id/i.test(text)) {
        return {
          rowCount: 1,
          rows: [{ user_id: 'u1', approval_amount_threshold: 50000, dry_run: true }],
        };
      }
      // 3. Invoice details query in orchestrator
      if (/where i\.id = any/i.test(text)) {
        return {
          rows: [
            {
              id: '11111111-1111-1111-1111-111111111111',
              client_id: 'c1',
              invoice_no: 'INV-SMALL',
              amount: 18000,
              paid_amount: 0,
              status: 'overdue',
              due_date: '2026-02-15',
              client_name: 'Acme Corp',
              client_email: 'acme@example.com',
            },
            {
              id: '22222222-2222-2222-2222-222222222222',
              client_id: 'c2',
              invoice_no: 'INV-LARGE',
              amount: 150000,
              paid_amount: 0,
              status: 'overdue',
              due_date: '2026-02-10',
              client_name: 'Wayne Enterprises',
              client_email: 'wayne@example.com',
            },
            {
              id: '33333333-3333-3333-3333-333333333333',
              client_id: 'c3',
              invoice_no: 'INV-DISPUTED',
              amount: 25000,
              paid_amount: 0,
              status: 'disputed',
              due_date: '2026-02-01',
              client_name: 'Umbrella Traders',
              client_email: 'umbrella@example.com',
            },
          ],
        };
      }
      // 4. Monitor query: returns small, large, and disputed invoices
      if (/from invoices i[\s\S]*join clients c/i.test(text)) {
        return {
          rows: [
            {
              invoice_id: '11111111-1111-1111-1111-111111111111',
              invoice_no: 'INV-SMALL',
              client_name: 'Acme Corp',
              amount: 18000,
              status: 'overdue',
              due_date: '2026-02-15',
              days_overdue: 15,
            },
            {
              invoice_id: '22222222-2222-2222-2222-222222222222',
              invoice_no: 'INV-LARGE',
              client_name: 'Wayne Enterprises',
              amount: 150000,
              status: 'overdue',
              due_date: '2026-02-10',
              days_overdue: 20,
            },
            {
              invoice_id: '33333333-3333-3333-3333-333333333333',
              invoice_no: 'INV-DISPUTED',
              client_name: 'Umbrella Traders',
              amount: 25000,
              status: 'disputed',
              due_date: '2026-02-01',
              days_overdue: 30,
            },
          ],
        };
      }
      // 5. Analyst scores query
      if (/from clients c[\s\S]*client_scores/i.test(text)) {
        return {
          rows: [
            { name: 'Acme Corp', avg_days_late: 2, on_time_rate: 95, risk_score: 10 },
            { name: 'Wayne Enterprises', avg_days_late: 25, on_time_rate: 50, risk_score: 60 },
            { name: 'Umbrella Traders', avg_days_late: 15, on_time_rate: 40, risk_score: 70 },
          ],
        };
      }
      // 6. Deduplication check: no active approvals yet
      if (/from approvals[\s\S]*status = 'pending'/i.test(text)) {
        return { rowCount: 0, rows: [] };
      }
      // 7. Rate limit check queries (none rate-limited)
      if (/from communications c[\s\S]*join invoices i/i.test(text)) {
        return { rowCount: 0, rows: [] };
      }
      // 8. Insert into communications, approvals, agent_logs
      if (/insert into communications/i.test(text) || /insert into approvals/i.test(text) || /insert into agent_logs/i.test(text)) {
        return { rowCount: 1, rows: [{ id: 'mock-id' }] };
      }
      return { rows: [] };
    });

    const res = await request(app).post('/api/agents/run').set(authHeader('u1'));

    expect(res.status).toBe(200);
    expect(res.body.steps).toHaveLength(3); // monitor, analyst, communicator
    expect(res.body.processed).toHaveLength(3);

    const smallResult = res.body.processed.find((p) => p.invoice_numbers === 'INV-SMALL');
    const largeResult = res.body.processed.find((p) => p.invoice_numbers === 'INV-LARGE');
    const dispResult = res.body.processed.find((p) => p.invoice_numbers === 'INV-DISPUTED');

    // Small invoice auto-sent
    expect(smallResult.action).toBe('auto_sent');
    expect(smallResult.dry_run).toBe(true);

    // Large invoice queued for approval (> ₹50,000 threshold)
    expect(largeResult.action).toBe('queued_for_approval');
    expect(largeResult.reason).toMatch(/exceeds approval threshold/i);

    // Disputed invoice queued for approval with neutral tone
    expect(dispResult.action).toBe('queued_for_approval');
    expect(dispResult.reason).toMatch(/disputed/i);
  });

  describe('POST /api/agents/cron-trigger', () => {
    it('returns 503 CRON_NOT_CONFIGURED when CRON_SECRET is unset in environment', async () => {
      delete process.env.CRON_SECRET;

      const res = await request(app)
        .post('/api/agents/cron-trigger')
        .set(authHeader('u1'))
        .set('x-cron-secret', 'any-secret');

      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe('CRON_NOT_CONFIGURED');
    });

    it('returns 401 UNAUTHORIZED when cron secret is missing or incorrect', async () => {
      process.env.CRON_SECRET = 'valid-super-secret-cron-token-1234';

      const resMissing = await request(app)
        .post('/api/agents/cron-trigger')
        .set(authHeader('u1'));

      expect(resMissing.status).toBe(401);
      expect(resMissing.body.error.code).toBe('UNAUTHORIZED');

      const resWrong = await request(app)
        .post('/api/agents/cron-trigger')
        .set(authHeader('u1'))
        .set('x-cron-secret', 'wrong-token-abc');

      expect(resWrong.status).toBe(401);
    });

    it('returns 200 and executes orchestrator when correct CRON_SECRET is supplied', async () => {
      process.env.CRON_SECRET = 'valid-super-secret-cron-token-1234';

      query.mockImplementation(async (text) => {
        if (/from users where id/i.test(text)) {
          return { rows: [{ id: 'u1', name: 'Demo Owner', email: 'demo@collectai.app' }] };
        }
        if (/from policies/i.test(text)) {
          return { rows: [{ approval_amount_threshold: 50000, dry_run: true }] };
        }
        if (/from invoices i[\s\S]*join clients c/i.test(text)) {
          return { rows: [] }; // No overdue
        }
        if (/insert into agent_logs/i.test(text)) {
          return { rowCount: 1, rows: [] };
        }
        return { rows: [] };
      });

      const res = await request(app)
        .post('/api/agents/cron-trigger')
        .set(authHeader('u1'))
        .set('x-cron-secret', 'valid-super-secret-cron-token-1234');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.triggered_at).toBeDefined();
    });
  });

  it('does NOT create duplicate pending approvals when agents are run a second time', async () => {
    query.mockImplementation(async (text) => {
      if (/from users where id/i.test(text)) {
        return { rows: [{ id: 'u1', name: 'Demo Owner', email: 'demo@collectai.app' }] };
      }
      if (/from policies/i.test(text)) {
        return { rows: [{ user_id: 'u1', approval_amount_threshold: 50000, dry_run: true }] };
      }
      if (/where i\.id = any/i.test(text)) {
        return {
          rows: [
            {
              id: '22222222-2222-2222-2222-222222222222',
              client_id: 'c2',
              invoice_no: 'INV-LARGE',
              amount: 150000,
              paid_amount: 0,
              status: 'overdue',
              due_date: '2026-02-10',
              client_name: 'Wayne Enterprises',
              client_email: 'wayne@example.com',
            },
          ],
        };
      }
      if (/from invoices i[\s\S]*join clients c/i.test(text)) {
        return {
          rows: [
            {
              invoice_id: '22222222-2222-2222-2222-222222222222',
              invoice_no: 'INV-LARGE',
              amount: 150000,
              paid_amount: 0,
              status: 'overdue',
              due_date: '2026-02-10',
              days_overdue: 20,
              client_name: 'Wayne Enterprises',
            },
          ],
        };
      }
      if (/from clients c[\s\S]*client_scores/i.test(text)) {
        return { rows: [{ name: 'Wayne Enterprises', avg_days_late: 25, on_time_rate: 50, risk_score: 60 }] };
      }
      // Deduplication check finds an ACTIVE pending approval for this invoice!
      if (/from approvals[\s\S]*status = 'pending'/i.test(text)) {
        return { rowCount: 1, rows: [{ id: 'existing-approval-id' }] };
      }
      if (/insert into agent_logs/i.test(text)) {
        return { rowCount: 1, rows: [{ id: 'log-id' }] };
      }
      return { rows: [] };
    });

    const res = await request(app).post('/api/agents/run').set(authHeader('u1'));

    expect(res.status).toBe(200);
    expect(res.body.processed).toHaveLength(1);
    expect(res.body.processed[0].action).toBe('skipped_already_pending_approval');
    expect(res.body.processed[0].reason).toMatch(/Pending approval already active/i);
  });

  it('excludes invoices with active pending dispute approvals from Monitor query', async () => {
    let monitorQueryExecuted = '';
    query.mockImplementation(async (text) => {
      if (/from users where id/i.test(text)) {
        return { rows: [{ id: 'u1', name: 'Owner' }] };
      }
      if (/from policies/i.test(text)) {
        return { rows: [{ approval_amount_threshold: 50000, dry_run: true }] };
      }
      if (/from invoices i[\s\S]*join clients c/i.test(text)) {
        monitorQueryExecuted = text;
        return { rows: [] }; // Muted
      }
      if (/insert into agent_logs/i.test(text)) {
        return { rowCount: 1, rows: [] };
      }
      return { rows: [] };
    });

    await request(app).post('/api/agents/run').set(authHeader('u1'));

    expect(monitorQueryExecuted.toLowerCase()).toContain('not exists');
    expect(monitorQueryExecuted.toLowerCase()).toContain('dispute_review');
  });

  it('GET /api/agents/logs returns user-scoped log entries', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ count: '2' }] })
      .mockResolvedValueOnce({
        rows: [
          { id: 'l1', user_id: 'u1', agent: 'monitor', reasoning: 'Found 1 flagged' },
          { id: 'l2', user_id: 'u1', agent: 'analyst', reasoning: 'Recommended firm tone' },
        ],
      });

    const res = await request(app).get('/api/agents/logs').set(authHeader('u1'));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0].agent).toBe('monitor');
  });
});
