import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { validate } from './validate.js';

// Run a middleware once and capture whatever it passes to next().
function run(mw, req) {
  return new Promise((resolve) => {
    mw(req, {}, (err) => resolve(err));
  });
}

describe('validate middleware', () => {
  it('accepts a valid body and strips unknown keys', async () => {
    const req = { body: { name: 'Ada', extra: 'remove me' } };
    const err = await run(validate({ body: z.object({ name: z.string() }) }), req);

    expect(err).toBeUndefined();
    expect(req.body).toEqual({ name: 'Ada' });
  });

  it('rejects an invalid body with a 400 VALIDATION_ERROR and field details', async () => {
    const schema = z.object({ email: z.string().email() });
    const req = { body: { email: 'not-an-email' } };
    const err = await run(validate({ body: schema }), req);

    expect(err).toBeDefined();
    expect(err.status).toBe(400);
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.details).toEqual([{ path: 'email', message: expect.any(String) }]);
  });

  it('validates params and query too', async () => {
    const req = { params: { id: 'abc' }, query: { page: '2' } };
    const err = await run(
      validate({
        params: z.object({ id: z.string().min(1) }),
        query: z.object({ page: z.coerce.number() }),
      }),
      req,
    );

    expect(err).toBeUndefined();
    expect(req.query).toEqual({ page: 2 }); // coerced
  });
});
