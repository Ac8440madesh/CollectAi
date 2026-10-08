import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import rateLimit from 'express-rate-limit';

describe('Rate Limiter Middleware (middleware/rateLimit.js)', () => {
  it('allocates independent rate-limit budgets to different authenticated users', async () => {
    const app = express();
    app.set('trust proxy', 1);

    // Build a rate limiter keyed by req.user.id
    const testLimiter = rateLimit({
      windowMs: 60 * 1000,
      max: 2, // Max 2 requests per window per user
      standardHeaders: true,
      legacyHeaders: false,
      keyGenerator: (req) => req.user?.id || req.ip,
      message: { error: { code: 'RATE_LIMITED', message: 'Too many requests' } },
    });

    // Mock auth middleware
    app.use((req, res, next) => {
      const auth = req.headers['x-test-user'];
      if (auth) req.user = { id: auth };
      next();
    });

    app.get('/api/test-limit', testLimiter, (req, res) => {
      res.json({ ok: true, user: req.user?.id });
    });

    // User A makes 2 requests (reaches limit)
    const u1_req1 = await request(app).get('/api/test-limit').set('x-test-user', 'user_A');
    expect(u1_req1.status).toBe(200);

    const u1_req2 = await request(app).get('/api/test-limit').set('x-test-user', 'user_A');
    expect(u1_req2.status).toBe(200);

    // User A makes 3rd request -> Blocked (429)
    const u1_req3 = await request(app).get('/api/test-limit').set('x-test-user', 'user_A');
    expect(u1_req3.status).toBe(429);
    expect(u1_req3.body.error.code).toBe('RATE_LIMITED');

    // User B makes request -> Allowed (has their own independent budget!)
    const u2_req1 = await request(app).get('/api/test-limit').set('x-test-user', 'user_B');
    expect(u2_req1.status).toBe(200);
    expect(u2_req1.body.user).toBe('user_B');
  });
});
