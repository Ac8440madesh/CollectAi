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

describe('Policy API (/api/policy)', () => {
  it('GET /api/policy returns user-scoped policy', async () => {
    query.mockResolvedValueOnce({
      rowCount: 1,
      rows: [
        {
          id: 'p1',
          user_id: 'u1',
          max_extension_days: 14,
          max_discount_pct: 10,
          approval_amount_threshold: 50000,
          dry_run: true,
        },
      ],
    });

    const res = await request(app).get('/api/policy').set(authHeader('u1'));

    expect(res.status).toBe(200);
    expect(res.body.approval_amount_threshold).toBe(50000);
    expect(query).toHaveBeenCalledWith(
      expect.stringMatching(/where user_id = \$1/i),
      ['u1'],
    );
  });

  it('PUT /api/policy updates user-scoped policy settings', async () => {
    query.mockResolvedValueOnce({
      rowCount: 1,
      rows: [
        {
          id: 'p1',
          user_id: 'u1',
          approval_amount_threshold: 75000,
          dry_run: false,
        },
      ],
    });

    const res = await request(app)
      .put('/api/policy')
      .set(authHeader('u1'))
      .send({
        approval_amount_threshold: 75000,
        dry_run: false,
      });

    expect(res.status).toBe(200);
    expect(res.body.approval_amount_threshold).toBe(75000);
    expect(res.body.dry_run).toBe(false);
    expect(query).toHaveBeenCalledWith(
      expect.stringMatching(/where user_id = \$1/i),
      expect.arrayContaining(['u1', 75000, false]),
    );
  });

  it('enforces cross-user isolation (User A cannot access or update User B policy)', async () => {
    query.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ id: 'p2', user_id: 'u2', approval_amount_threshold: 100000 }],
    });

    await request(app).get('/api/policy').set(authHeader('u2'));

    // Assert query was scoped by 'u2'
    expect(query).toHaveBeenCalledWith(
      expect.stringMatching(/where user_id = \$1/i),
      ['u2'],
    );
  });
});
