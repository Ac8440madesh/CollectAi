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

describe('Clients API (/api/clients)', () => {
  it('GET /api/clients lists user-scoped clients with scores', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ count: '1' }] }) // count query
      .mockResolvedValueOnce({
        rows: [{ id: 'c1', user_id: 'u1', name: 'Acme', risk_score: 15, avg_days_late: 2 }],
      });

    const res = await request(app).get('/api/clients').set(authHeader('u1'));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].name).toBe('Acme');
    expect(query).toHaveBeenCalledWith(
      expect.stringMatching(/where c\.user_id = \$1/i),
      expect.arrayContaining(['u1']),
    );
  });

  it('POST /api/clients creates a client scoped to user', async () => {
    query.mockResolvedValueOnce({
      rows: [{ id: 'c1', user_id: 'u1', name: 'Beta Inc', payment_terms_days: 30 }],
    });

    const res = await request(app)
      .post('/api/clients')
      .set(authHeader('u1'))
      .send({ name: 'Beta Inc', email: 'beta@example.com', payment_terms_days: 30 });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Beta Inc');
    expect(query).toHaveBeenCalledWith(
      expect.stringMatching(/insert into clients/i),
      expect.arrayContaining(['u1', 'Beta Inc']),
    );
  });

  it('PUT /api/clients/:id updates only own client', async () => {
    query.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ id: '11111111-1111-1111-1111-111111111111', user_id: 'u1', name: 'Updated' }],
    });

    const res = await request(app)
      .put('/api/clients/11111111-1111-1111-1111-111111111111')
      .set(authHeader('u1'))
      .send({ name: 'Updated' });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Updated');
    expect(query).toHaveBeenCalledWith(
      expect.stringMatching(/where id = \$1 and user_id = \$2/i),
      ['11111111-1111-1111-1111-111111111111', 'u1', 'Updated'],
    );
  });

  it('DELETE /api/clients/:id deletes only own client', async () => {
    query.mockResolvedValueOnce({ rowCount: 1 });

    const res = await request(app)
      .delete('/api/clients/11111111-1111-1111-1111-111111111111')
      .set(authHeader('u1'));

    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(true);
    expect(query).toHaveBeenCalledWith(
      expect.stringMatching(/delete from clients where id = \$1 and user_id = \$2/i),
      ['11111111-1111-1111-1111-111111111111', 'u1'],
    );
  });

  it('rejects unauthenticated requests with 401', async () => {
    const res = await request(app).get('/api/clients');
    expect(res.status).toBe(401);
  });
});
