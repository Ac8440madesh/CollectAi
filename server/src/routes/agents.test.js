import { describe, it, expect, beforeEach, vi } from 'vitest';
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

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Agents API (/api/agents)', () => {
  it('POST /api/agents/run executes orchestrator in mock mode and logs results', async () => {
    // 1. Monitor query returns 1 overdue invoice
    query.mockImplementation(async (text) => {
      if (/from invoices i/i.test(text)) {
        return {
          rows: [
            {
              invoice_id: '11111111-1111-1111-1111-111111111111',
              invoice_no: 'INV-301',
              client_name: 'Initech',
              amount: 45000,
              status: 'overdue',
              due_date: '2026-02-15',
              days_overdue: 20,
            },
          ],
        };
      }
      if (/from clients c[\s\S]*client_scores/i.test(text)) {
        return {
          rows: [
            { name: 'Initech', avg_days_late: 25, on_time_rate: 30, risk_score: 75 },
          ],
        };
      }
      if (/insert into agent_logs/i.test(text)) {
        return { rowCount: 1, rows: [{ id: 'log-1' }] };
      }
      return { rows: [] };
    });

    const res = await request(app).post('/api/agents/run').set(authHeader('u1'));

    expect(res.status).toBe(200);
    expect(res.body.steps).toHaveLength(2);
    expect(res.body.steps[0].agent).toBe('monitor');
    expect(res.body.steps[0].data.flagged_invoices).toHaveLength(1);
    expect(res.body.steps[1].agent).toBe('analyst');
    expect(res.body.steps[1].data.recommendations).toHaveLength(1);
    expect(res.body.steps[1].data.recommendations[0].tone).toBe('firm');
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
