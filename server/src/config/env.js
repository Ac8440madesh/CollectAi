import dotenv from 'dotenv';
import { z } from 'zod';

// Load server/.env in normal runs. In tests, env comes from vitest.config.js so
// we never read the real .env (and never need real secrets to run tests).
if (process.env.NODE_ENV !== 'test') {
  dotenv.config();
}

/**
 * Environment schema. Variables are added here in the phase that first needs
 * them. Validation errors print the KEY and a message — never the value — so
 * secrets are never logged.
 */
const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4000),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  FRONTEND_ORIGIN: z.string().url().default('http://localhost:5173'),

  // Phase 1: database + auth
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required (see server/.env.example)'),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  JWT_EXPIRES_IN: z.string().default('7d'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid or missing environment variables:');
  // flatten() gives { fieldErrors: { KEY: [messages] } } — keys/messages only.
  console.error(JSON.stringify(parsed.error.flatten().fieldErrors, null, 2));
  console.error('→ Copy server/.env.example to server/.env and fill in the values.');
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
