import { pool } from '../src/config/db.js';
import { runOrchestrator } from '../src/agents/orchestrator.js';

async function main() {
  console.log('Testing Phase 2 Orchestrator against database in LLM_MODE=mock...');

  // Find the seeded demo owner
  const userRes = await pool.query("select id, email from users where email = 'demo@collectai.app'");
  if (userRes.rowCount === 0) {
    throw new Error("Demo owner 'demo@collectai.app' not found. Run 'npm run seed' first.");
  }
  const userId = userRes.rows[0].id;
  console.log(`Using demo user ID: ${userId} (${userRes.rows[0].email})`);

  // Run the orchestrator
  const result = await runOrchestrator(userId);
  console.log('\n--- Orchestrator Execution Steps ---');
  console.log(JSON.stringify(result, null, 2));

  // Query and display the fresh agent_logs
  const logsRes = await pool.query(
    'select agent, input_summary, reasoning, output_json, created_at from agent_logs where user_id = $1 order by created_at desc limit 10',
    [userId],
  );
  console.log('\n--- Agent Audit Logs (Database) ---');
  console.log(`Total logs fetched: ${logsRes.rows.length}`);
  for (const log of logsRes.rows) {
    console.log(`\n[${log.agent.toUpperCase()}] at ${log.created_at.toISOString()}`);
    console.log(`  Input:     ${log.input_summary}`);
    console.log(`  Reasoning: ${log.reasoning}`);
  }
}

main()
  .catch((err) => {
    console.error('Test run failed:', err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
