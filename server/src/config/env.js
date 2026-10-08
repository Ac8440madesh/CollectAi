import 'dotenv/config';
import { z } from 'zod';

/**
 * Environment schema.
 *
 * Only the variables Phase 0 actually needs to boot are validated here. More
 * variables (DATABASE_URL, JWT_SECRET, LLM_*, SMTP_*) are declared in
 * `.env.example` and will be added to this schema in the phase that first uses
 * them, so a missing-but-not-yet-needed value never blocks the server.
 *
 * Unknown keys in process.env are ignored (Zod strips them), so the full
 * `.env` can contain future variables without failing validation.
 */
const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4000),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  FRONTEND_ORIGIN: z.string().url().default('http://localhost:5173'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:');
  console.error(JSON.stringify(parsed.error.flatten().fieldErrors, null, 2));
  console.error('Copy server/.env.example to server/.env and fill in the values.');
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
