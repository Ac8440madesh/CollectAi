/**
 * Full End-to-End Seeded Scenario Test with Line-Item Scoring Audit.
 *
 * Golden path workflow:
 * 1. Reset demo database to clean state.
 * 2. Overdue Invoice -> Autonomous Agent Reminder (Monitor -> Analyst -> Communicator -> Auto-Sent).
 * 3. Client Inbound Reply -> Negotiator Agent evaluation.
 * 4. In-policy payment extension agreed autonomously and stored in DB (extended_due_date).
 * 5. Case A: Payment settled WITHIN agreed extension window -> 75% on-time credit.
 * 6. Case B: Payment settled LATE after extension window -> 0% on-time credit & late penalty.
 * 7. Per-invoice breakdown table and dashboard verification.
 */
import { pool } from '../src/config/db.js';
import { runOrchestrator } from '../src/agents/orchestrator.js';
import { runNegotiator } from '../src/agents/negotiator.js';
import { runReconciler } from '../src/agents/reconciler.js';
import { getTodayIST } from '../src/utils/dates.js';

function formatISTDate(d) {
  if (!d) return 'None      ';
  if (typeof d === 'string') return d.slice(0, 10);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

async function printClientScoringAudit(clientId, clientName) {
  const invRes = await pool.query(
    `select i.invoice_no, i.amount, i.due_date, i.extended_due_date, i.status,
            max(p.paid_on) as paid_on
     from invoices i
     left join payments p on p.invoice_id = i.id
     where i.client_id = $1
     group by i.id
     order by i.invoice_no asc`,
    [clientId],
  );

  console.log(`\n   ┌─ Per-Invoice Payment Audit for ${clientName} ─────────────────────────────┐`);
  console.log('   │ Invoice   │ Due Date   │ Ext Due    │ Paid On    │ Days Late │ Credit │');
  console.log('   ├───────────┼────────────┼────────────┼────────────┼───────────┼────────┤');

  let totalCredit = 0;
  let totalLateDays = 0;
  let paidCount = 0;

  for (const inv of invRes.rows) {
    if (inv.status !== 'paid' || !inv.paid_on) continue;
    paidCount += 1;

    const origDueStr = formatISTDate(inv.due_date);
    const extDueStr = inv.extended_due_date ? formatISTDate(inv.extended_due_date) : origDueStr;
    const paidStr = formatISTDate(inv.paid_on);

    const origDue = new Date(origDueStr);
    const extDue = new Date(extDueStr);
    const paid = new Date(paidStr);

    const diffOrig = Math.round((paid - origDue) / 86400000);
    const diffExt = Math.round((paid - extDue) / 86400000);

    let credit = 0;
    let daysLate = 0;

    if (diffOrig <= 0) {
      credit = 1.0;
      daysLate = 0;
    } else if (diffExt <= 0) {
      credit = 0.75;
      daysLate = 0;
    } else {
      credit = 0.0;
      daysLate = diffExt;
    }

    totalCredit += credit;
    totalLateDays += daysLate;

    const extDisplay = inv.extended_due_date ? extDueStr : 'None      ';

    console.log(
      `   │ ${inv.invoice_no.padEnd(9)} │ ${origDueStr} │ ${extDisplay} │ ${paidStr} │ ${daysLate.toString().padStart(9)} │ ${credit.toFixed(2).padStart(6)} │`,
    );
  }

  const onTimeRate = paidCount > 0 ? Math.round((totalCredit / paidCount) * 100) : 0;
  const avgDaysLate = paidCount > 0 ? (totalLateDays / paidCount).toFixed(2) : '0.00';
  const riskScore = Math.min(Math.max(Math.round((100 - onTimeRate) * 0.5 + Math.min(avgDaysLate * 1.5, 30)), 0), 100);

  console.log('   └───────────┴────────────┴────────────┴────────────┴───────────┴────────┘');
  console.log(`   Aggregate: On-Time Rate = (${totalCredit}/${paidCount}) × 100 = ${onTimeRate}% | Avg Days Late = ${totalLateDays}/${paidCount} = ${avgDaysLate}d | Risk Score = ${riskScore}/100\n`);
}

async function main() {
  console.log('================================================================');
  console.log('   CollectAI End-to-End Seeded Scenario Execution');
  console.log('================================================================\n');

  // 1. Fetch Demo User
  const userRes = await pool.query("select id, email, name, business_name from users where email = 'demo@collectai.app'");
  if (userRes.rowCount === 0) {
    throw new Error("Demo owner not found. Please run 'npm run demo:reset -- --yes' first.");
  }
  const user = userRes.rows[0];
  const userId = user.id;

  const policyRes = await pool.query('select * from policies where user_id = $1', [userId]);
  const policy = policyRes.rows[0];

  // Clean prior communications & approvals for a fresh run
  await pool.query('delete from approvals where user_id = $1', [userId]);
  await pool.query(
    'delete from communications where invoice_id in (select id from invoices where user_id = $1)',
    [userId],
  );

  const todayIST = getTodayIST();

  // Set Acme Corp's INV-1002 (₹18,000) to overdue (-5 days from today IST)
  await pool.query(
    `update invoices
     set due_date = ($1::date - interval '5 days')::date, extended_due_date = null, status = 'overdue', paid_amount = 0
     where invoice_no = 'INV-1002' and user_id = $2`,
    [todayIST, userId],
  );

  // ───────────────────────────────────────────────────────────────────────────
  // STEP 1 & 2: Autonomous Agent Reminder
  // ───────────────────────────────────────────────────────────────────────────
  console.log('▶ STEP 1 & 2: Running Autonomous Orchestrator on Overdue Invoices...');
  const orchResult = await runOrchestrator(userId);

  const acmeAction = orchResult.processed.find((p) => p.invoice_numbers?.includes('INV-1002') || p.client_name === 'Acme Corp');
  console.log(`   Action:  ${acmeAction?.action} (${acmeAction?.dry_run ? 'Dry Run' : 'Live'})`);
  console.log(`   Subject: "${acmeAction?.subject}"\n`);

  // Fetch invoice record
  const invRes = await pool.query(
    "select i.*, c.id as client_id, c.name as client_name, c.email as client_email from invoices i join clients c on c.id = i.client_id where i.invoice_no = 'INV-1002' and i.user_id = $1",
    [userId],
  );
  const invoice = invRes.rows[0];
  const client = { id: invoice.client_id, name: invoice.client_name, email: invoice.client_email };

  // ───────────────────────────────────────────────────────────────────────────
  // STEP 3 & 4: Inbound Client Reply & Negotiator Agent
  // ───────────────────────────────────────────────────────────────────────────
  console.log('▶ STEP 3 & 4: Simulating Inbound Client Reply & Negotiator Agent...');
  const clientReply = 'Hi team, could we please request a 7-day extension to arrange the funds? We will pay next week.';
  console.log(`   Client Message: "${clientReply}"`);

  // Record inbound message
  await pool.query(
    `insert into communications (invoice_id, direction, channel, subject, body, status)
     values ($1, 'inbound', 'email', 'Inbound Reply for INV-1002', $2, 'sent')`,
    [invoice.id, clientReply],
  );

  const negotiation = await runNegotiator({
    userId,
    invoice,
    client,
    policy,
    user,
    clientMessage: clientReply,
  });

  console.log(`   Detected Intent:   ${negotiation.intent}`);
  console.log(`   Escalate to Owner: ${negotiation.escalate ? 'YES' : 'NO (Auto-accepted in policy)'}`);
  console.log(`   Proposed Terms:    ${JSON.stringify(negotiation.proposed_terms)}`);
  console.log(`   Agent Response:\n   "${negotiation.proposed_response.replace(/\n/g, '\n   ')}"\n`);

  // Store the exact agreed new_due_date in DB
  await pool.query(
    'update invoices set extended_due_date = $1 where id = $2',
    [negotiation.proposed_terms.new_due_date, invoice.id],
  );

  await pool.query(
    `insert into communications (invoice_id, direction, channel, subject, body, status)
     values ($1, 'outbound', 'email', 'Re: Payment arrangement for Invoice INV-1002', $2, 'sent')`,
    [invoice.id, negotiation.proposed_response],
  );

  // ───────────────────────────────────────────────────────────────────────────
  // STEP 5 - CASE A: Payment Settled WITHIN Agreed Extension Window
  // ───────────────────────────────────────────────────────────────────────────
  console.log('▶ STEP 5 (CASE A): Payment Settled WITHIN Agreed Extension Window...');
  const paymentAmountA = 18000;

  // Insert payment record on todayIST
  await pool.query(
    `insert into payments (invoice_id, amount, paid_on, method, reference)
     values ($1, $2, $3, 'upi', 'UPI-EXTENSION-SETTLED')`,
    [invoice.id, paymentAmountA, todayIST],
  );

  // Update invoice status
  await pool.query(
    "update invoices set paid_amount = $1, status = 'paid' where id = $2",
    [paymentAmountA, invoice.id],
  );

  await runReconciler({
    userId,
    invoiceId: invoice.id,
    paymentAmount: paymentAmountA,
    newStatus: 'paid',
  });

  // Print line-item breakdown for Acme Corp
  await printClientScoringAudit(client.id, client.name);

  // ───────────────────────────────────────────────────────────────────────────
  // STEP 5 - CASE B: Payment Settled LATE Past Extension Window
  // ───────────────────────────────────────────────────────────────────────────
  console.log('▶ STEP 5 (CASE B): Payment Settled LATE Past Extension Window...');

  const globexInvRes = await pool.query(
    "select i.*, c.id as client_id, c.name as client_name from invoices i join clients c on c.id = i.client_id where i.invoice_no = 'INV-2001' and i.user_id = $1",
    [userId],
  );
  const globexInv = globexInvRes.rows[0];

  const due30dAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const ext15dAgo = new Date(Date.now() - 15 * 86400000).toISOString().slice(0, 10);

  await pool.query(
    'update invoices set due_date = $1, extended_due_date = $2, paid_amount = 54000, status = \'paid\' where id = $3',
    [due30dAgo, ext15dAgo, globexInv.id],
  );

  await pool.query(
    `insert into payments (invoice_id, amount, paid_on, method, reference)
     values ($1, 54000, $2, 'bank', 'NEFT-LATE-PAST-EXT')`,
    [globexInv.id, todayIST],
  );

  await runReconciler({
    userId,
    invoiceId: globexInv.id,
    paymentAmount: 54000,
    newStatus: 'paid',
  });

  // Print line-item breakdown for Globex Pvt Ltd
  await printClientScoringAudit(globexInv.client_id, globexInv.client_name);

  // ───────────────────────────────────────────────────────────────────────────
  // STEP 6: Dashboard Verification
  // ───────────────────────────────────────────────────────────────────────────
  console.log('▶ STEP 6: Verifying Updated Dashboard Receivables Metrics...');
  const summaryRes = await pool.query(
    `select
       coalesce(sum(case when status in ('pending', 'overdue', 'partial', 'disputed') then (amount - paid_amount) else 0 end), 0) as outstanding,
       coalesce(sum(case when status = 'overdue' then (amount - paid_amount) else 0 end), 0) as overdue,
       coalesce(sum(paid_amount), 0) as recovered
     from invoices where user_id = $1`,
    [userId],
  );
  const sum = summaryRes.rows[0];
  console.log(`   Active Outstanding: ₹${parseFloat(sum.outstanding).toLocaleString('en-IN')}`);
  console.log(`   Total Recovered:    ₹${parseFloat(sum.recovered).toLocaleString('en-IN')}`);

  console.log('\n================================================================');
  console.log('   ✅ End-to-End Scenario Successfully Completed!');
  console.log('================================================================');
}

main()
  .catch((err) => {
    console.error('Scenario test failed:', err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
