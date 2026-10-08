import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

// Mock the database layer so these tests need no Postgres and no real secrets.
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

const JWT_SECRET = process.env.JWT_SECRET; // from vitest.config.js

// Controls what the "does this email already exist?" check returns per test.
let existingRowCount = 0;

beforeEach(() => {
  vi.clearAllMocks();
  existingRowCount = 0;

  // A transaction client whose behaviour depends on the SQL text.
  const client = { query: clientQuery, release: vi.fn() };
  pool.connect.mockResolvedValue(client);

  clientQuery.mockImplementation(async (text) => {
    if (/begin|commit|rollback/i.test(text)) return {};
    if (/from users where email/i.test(text)) {
      return { rowCount: existingRowCount, rows: existingRowCount ? [{ id: 'existing' }] : [] };
    }
    if (/insert into users/i.test(text)) {
      return { rows: [{ id: 'u1', name: 'New User', email: 'new@collectai.app', business_name: 'NW' }] };
    }
    if (/insert into policies/i.test(text)) return {};
    return { rows: [], rowCount: 0 };
  });

  query.mockResolvedValue({ rows: [], rowCount: 0 });
});

describe('POST /api/auth/register', () => {
  it('creates a user and returns a token (no password_hash leaked)', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'New User', email: 'new@collectai.app', password: 'password1', business_name: 'NW' });

    expect(res.status).toBe(201);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user).toMatchObject({ id: 'u1', email: 'new@collectai.app' });
    expect(res.body.user.password_hash).toBeUndefined();
  });

  it('rejects a duplicate email with 409', async () => {
    existingRowCount = 1;
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'New User', email: 'new@collectai.app', password: 'password1' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_TAKEN');
  });

  it('rejects an invalid body with 400', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'not-an-email', password: 'short' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('POST /api/auth/login', () => {
  it('returns a token for correct credentials', async () => {
    const password_hash = bcrypt.hashSync('password1', 10);
    query.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ id: 'u1', name: 'A', email: 'a@b.com', business_name: null, password_hash }],
    });

    const res = await request(app).post('/api/auth/login').send({ email: 'a@b.com', password: 'password1' });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.email).toBe('a@b.com');
  });

  it('rejects a wrong password with 401', async () => {
    const password_hash = bcrypt.hashSync('password1', 10);
    query.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'u1', email: 'a@b.com', password_hash }] });

    const res = await request(app).post('/api/auth/login').send({ email: 'a@b.com', password: 'wrong-password' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('rejects an unknown email with 401', async () => {
    query.mockResolvedValueOnce({ rowCount: 0, rows: [] });

    const res = await request(app).post('/api/auth/login').send({ email: 'nobody@b.com', password: 'password1' });

    expect(res.status).toBe(401);
  });
});

describe('GET /api/auth/me (protected)', () => {
  it('rejects a request with no token (401)', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('rejects a bad token (401)', async () => {
    const res = await request(app).get('/api/auth/me').set('Authorization', 'Bearer not-a-real-token');
    expect(res.status).toBe(401);
  });

  it('returns the scoped user for a valid token (200)', async () => {
    const token = jwt.sign({ sub: 'u1', email: 'a@b.com' }, JWT_SECRET, { expiresIn: '1h' });
    query.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ id: 'u1', name: 'A', email: 'a@b.com', business_name: null }],
    });

    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe('u1');
    // The query must be scoped by the user id from the token.
    expect(query).toHaveBeenCalledWith(expect.stringMatching(/where id = \$1/i), ['u1']);
  });
});
