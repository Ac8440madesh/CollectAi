import pg from 'pg';
import { env } from './env.js';

const { Pool } = pg;

// Supabase (and any non-local Postgres) requires SSL; local Postgres does not.
// rejectUnauthorized:false is the standard setting for Supabase's managed certs.
const isLocal = /@(localhost|127\.0\.0\.1)[:/]/.test(env.DATABASE_URL);

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  ssl: isLocal ? false : { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

// Log the message only — never the connection string.
pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL pool error:', err.message);
});

/**
 * Run a parameterized query. ALWAYS pass user input through `params` — never
 * build SQL with string concatenation.
 *
 *   query('select * from users where id = $1', [id])
 */
export function query(text, params) {
  return pool.query(text, params);
}
