import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

import { query, pool } from '../config/db.js';
import { env } from '../config/env.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { authLimiter } from '../middleware/rateLimit.js';
import { registerSchema, loginSchema } from '../schemas/auth.js';
import { AppError } from '../middleware/errorHandler.js';

const router = Router();

const BCRYPT_ROUNDS = 10;

function signToken(user) {
  return jwt.sign({ sub: user.id, email: user.email }, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN,
  });
}

// Only ever expose non-sensitive fields (never password_hash).
function publicUser(u) {
  return { id: u.id, name: u.name, email: u.email, business_name: u.business_name };
}

/**
 * POST /api/auth/register
 * Creates a user (bcrypt-hashed password) plus a default policy row, in one
 * transaction. Returns a JWT so the client is logged in immediately.
 */
router.post('/register', authLimiter, validate({ body: registerSchema }), async (req, res, next) => {
  const { name, email, password, business_name } = req.body;
  const client = await pool.connect();
  try {
    await client.query('begin');

    const existing = await client.query('select 1 from users where email = $1', [email]);
    if (existing.rowCount > 0) {
      throw new AppError(409, 'EMAIL_TAKEN', 'An account with this email already exists');
    }

    const password_hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const inserted = await client.query(
      `insert into users (name, email, password_hash, business_name)
       values ($1, $2, $3, $4)
       returning id, name, email, business_name`,
      [name, email, password_hash, business_name ?? null],
    );
    const user = inserted.rows[0];

    // Give every new owner a default guardrail policy (used from Phase 3).
    await client.query('insert into policies (user_id) values ($1)', [user.id]);

    await client.query('commit');
    res.status(201).json({ token: signToken(user), user: publicUser(user) });
  } catch (err) {
    await client.query('rollback').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

/**
 * POST /api/auth/login
 * Verifies email + password and returns a JWT. Uses a single generic error for
 * both "no such user" and "wrong password" to avoid leaking which emails exist.
 */
router.post('/login', authLimiter, validate({ body: loginSchema }), async (req, res, next) => {
  const { email, password } = req.body;
  try {
    const result = await query(
      'select id, name, email, business_name, password_hash from users where email = $1',
      [email],
    );
    const user = result.rows[0];
    const ok = user && (await bcrypt.compare(password, user.password_hash));
    if (!ok) {
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
    }
    res.json({ token: signToken(user), user: publicUser(user) });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/auth/me  (protected)
 * Returns the current user, scoped by the id inside the JWT — the canonical
 * proof that auth + per-user scoping work.
 */
router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const result = await query(
      'select id, name, email, business_name from users where id = $1',
      [req.user.id],
    );
    const user = result.rows[0];
    if (!user) throw new AppError(404, 'NOT_FOUND', 'User not found');
    res.json({ user: publicUser(user) });
  } catch (err) {
    next(err);
  }
});

export default router;
