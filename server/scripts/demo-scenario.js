import { pool } from '../src/config/db.js';
import { runOrchestrator } from '../src/agents/orchestrator.js';

async function main() {
  console.log('================================================================');
  console.log('   CollectAI Phase 3 Multi-Agent Pipeline & Guardrail Demo');
  console.log('================================================================\n');

  // 1. Fetch demo user
  const userRes = await pool.query("select id, email from users where email = 'demo@collectai.app'");
  if (userRes.rowCount === 0) {
    throw new Error("Demo owner not found. Run 'npm run seed' first.");
  }
  const userId = userRes.rows[0].id;

  // 2. Fetch user policy
  const policyRes = await pool.query('select * from policies where user_id = $1', [userId]);
  const policy = policyRes.rows[0];
  console.log('Owner Guardrail Policy:');
  console.log(` - Approval Threshold: ₹${parseFloat(policy.approval_amount_threshold).toLocaleString('en-IN')}`);
  console.log(` - Dry Run Mode:       ${policy.dry_run ? 'ENABLED (Safe simulation)' : 'DISABLED'}`);
  console.log(` - Rate Limit:         1 reminder per client every 3 days\n`);

  // Clear previous communications/approvals for a clean demo run
  await pool.query('delete from approvals where user_id = $1', [userId]);
  await pool.query(
    'delete from communications where invoice_id in (select id from invoices where user_id = $1)',
    [userId],
  );

  // Set Acme Corp's small invoice INV-1002 (₹18,000) to overdue (-5 days) to demonstrate auto-processing
  await pool.query(
    "update invoices set due_date = current_date - interval '5 days', status = 'overdue' where invoice_no = 'INV-1002' and user_id = $1",
    [userId],
  );

  console.log('▶ Running Autonomous Orchestrator (Monitor -> Analyst -> Communicator -> Guardrails)...\n');
  const result = await runOrchestrator(userId);

  console.log('----------------------------------------------------------------');
  console.log('   Processed Client Actions Summary');
  console.log('----------------------------------------------------------------');
  for (const item of result.processed) {
    if (item.action === 'auto_sent') {
      console.log(`\n✅ [AUTO-SENT (Dry Run)] Client: ${item.client_name} (Invoices: ${item.invoice_numbers})`);
      console.log(`   Subject: "${item.subject}"`);
      console.log('   Reason:  Amount is within owner approval threshold (≤ ₹50,000), healthy client history');
    } else if (item.action === 'queued_for_approval') {
      console.log(`\n⏸️  [QUEUED FOR APPROVAL] Client: ${item.client_name} (Invoices: ${item.invoice_numbers})`);
      console.log(`   Approval ID: ${item.approval_id}`);
      console.log(`   Gate Reason: ${item.reason}`);
    } else {
      console.log(`\n⏭️  [${item.action.toUpperCase()}] Client: ${item.client_name} (${item.invoice_numbers}): ${item.reason}`);
    }
  }

  // 3. Inspect Approvals Queue
  const approvalsRes = await pool.query(
    `select a.id, a.reason, a.recommendation, i.invoice_no, i.amount, c.name as client_name, comm.subject as draft_subject, comm.body as draft_body
     from approvals a
     join invoices i on i.id = a.invoice_id
     join clients c on c.id = i.client_id
     left join communications comm on comm.id = a.communication_id
     where a.user_id = $1 and a.status = 'pending'`,
    [userId],
  );

  console.log('\n================================================================');
  console.log(`   Human Owner Approvals Queue (${approvalsRes.rows.length} pending items)`);
  console.log('================================================================');
  for (const app of approvalsRes.rows) {
    console.log(`\n📋 Item ID: ${app.id}`);
    console.log(`   Client:   ${app.client_name} (Invoice: ${app.invoice_no})`);
    console.log(`   Reason:   ${app.reason}`);
    console.log(`   AI Recom: ${app.recommendation}`);
    console.log(`   Draft:    "${app.draft_subject}"`);
  }
}

main()
  .catch((err) => {
    console.error('Demo failed:', err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
