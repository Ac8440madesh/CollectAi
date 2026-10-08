/**
 * Create the database schema.
 *   npm run db:init
 *
 * Reads sql/schema.sql and runs it against DATABASE_URL (from server/.env).
 * The schema uses `create ... if not exists`, so this is safe to re-run.
 * Never prints the connection string.
 */
import { readFile } from 'node:fs/promises';
import { pool } from '../src/config/db.js';

async function main() {
  const sqlUrl = new URL('../sql/schema.sql', import.meta.url);
  const sql = await readFile(sqlUrl, 'utf8');

  console.log('Applying schema.sql …');
  await pool.query(sql);
  console.log('✅ Schema applied successfully.');
}

main()
  .catch((err) => {
    console.error('❌ Failed to apply schema:', err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
