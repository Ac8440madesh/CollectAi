/**
 * Demo Reset Script.
 *   npm run demo:reset -- --yes
 *
 * Restores the demo user's data (demo@collectai.app) to the clean seeded state:
 * - Resets demo policy (threshold = ₹50,000, dry_run = true)
 * - 5 demo clients (Acme, Globex, Initech, Umbrella, Wayne)
 * - 14 demo invoices with paid, pending, overdue, partial, and disputed states
 * - Seeded payments and client risk scores
 * - Cleans prior communications, approvals, and agent_logs for the demo user
 *
 * SAFEGUARDS:
 * 1. Refuses to run if NODE_ENV === 'production'.
 * 2. Refuses to run without the --yes confirmation flag.
 * 3. Scoped strictly to demo@collectai.app — does NOT touch other users.
 * 4. Never reads, modifies, or prints .env secrets.
 */
import bcrypt from 'bcryptjs';
import { pool } from '../src/config/db.js';

const DEMO_EMAIL = 'demo@collectai.app';
const DEMO_PASSWORD = 'demo1234';

const iso = (d) => d.toISOString().slice(0, 10);
function offsetDays(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return iso(d);
}

const clients = [
  { name: 'Acme Corp', email: 'acme@example.com', phone: '9000000001', terms: 30, notes: 'Reliable, pays on time.' },
  { name: 'Globex Pvt Ltd', email: 'billing@globex.example', phone: '9000000002', terms: 45, notes: 'Usually a few weeks late.' },
  { name: 'Initech Solutions', email: 'accounts@initech.example', phone: '9000000003', terms: 30, notes: 'Chronic late payer.' },
  { name: 'Umbrella Traders', email: 'finance@umbrella.example', phone: '9000000004', terms: 15, notes: 'Occasionally disputes invoices.' },
  { name: 'Wayne Enterprises', email: 'ap@wayne.example', phone: '9000000005', terms: 60, notes: 'Large contracts, slow cycle.' },
];

const invoices = [
  { c: 0, no: 'INV-1001', amount: 25000, issue: -60, due: -30, status: 'paid', paid: 25000, pay: { amount: 25000, on: -28, method: 'upi', ref: 'UPI-1001' } },
  { c: 0, no: 'INV-1002', amount: 18000, issue: -20, due: 10, status: 'pending', paid: 0 },
  { c: 0, no: 'INV-1003', amount: 32000, issue: -90, due: -60, status: 'paid', paid: 32000, pay: { amount: 32000, on: -58, method: 'bank', ref: 'NEFT-1003' } },
  { c: 1, no: 'INV-2001', amount: 54000, issue: -75, due: -30, status: 'overdue', paid: 0 },
  { c: 1, no: 'INV-2002', amount: 40000, issue: -50, due: -5, status: 'partial', paid: 15000, pay: { amount: 15000, on: -10, method: 'upi', ref: 'UPI-2002' } },
  { c: 2, no: 'INV-3001', amount: 22000, issue: -120, due: -90, status: 'overdue', paid: 0 },
  { c: 2, no: 'INV-3002', amount: 15000, issue: -80, due: -50, status: 'overdue', paid: 0 },
  { c: 2, no: 'INV-3003', amount: 12000, issue: -100, due: -70, status: 'paid', paid: 12000, pay: { amount: 12000, on: -40, method: 'cash', ref: 'CASH-3003' } },
  { c: 3, no: 'INV-4001', amount: 30000, issue: -40, due: -25, status: 'disputed', paid: 0 },
  { c: 3, no: 'INV-4002', amount: 9000, issue: -10, due: 5, status: 'pending', paid: 0 },
  { c: 4, no: 'INV-5001', amount: 150000, issue: -30, due: 30, status: 'pending', paid: 0 },
  { c: 4, no: 'INV-5002', amount: 220000, issue: -90, due: -30, status: 'overdue', paid: 0 },
  { c: 4, no: 'INV-5003', amount: 180000, issue: -75, due: -15, status: 'partial', paid: 90000, pay: { amount: 90000, on: -20, method: 'bank', ref: 'NEFT-5003' } },
  { c: 4, no: 'INV-5004', amount: 120000, issue: -120, due: -60, status: 'paid', paid: 120000, pay: { amount: 120000, on: -62, method: 'bank', ref: 'NEFT-5004' } },
];

const scores = [
  { avg: 1.5, onTime: 95, risk: 12 },
  { avg: 20, onTime: 55, risk: 55 },
  { avg: 45, onTime: 20, risk: 85 },
  { avg: 15, onTime: 40, risk: 70 },
  { avg: 25, onTime: 50, risk: 60 },
];

async function main() {
  // Safeguard 1: Refuse to run in production
  if (process.env.NODE_ENV === 'production') {
    console.error('❌ Refusing to run demo reset in production environment (NODE_ENV=production).');
    process.exit(1);
  }

  // Safeguard 2: Require confirmation flag
  const hasYesFlag = process.argv.includes('--yes') || process.argv.includes('-y');
  if (!hasYesFlag) {
    console.log('================================================================');
    console.log('   CollectAI Demo Reset (Dry Run / Confirmation Required)');
    console.log('================================================================');
    console.log('\nThis command will delete and re-seed the following:');
    console.log(` - Demo User Account: ${DEMO_EMAIL}`);
    console.log(` - 5 demo clients and their risk scores`);
    console.log(` - 14 seeded demo invoices and 6 payment records`);
    console.log(` - All communications, approvals, and agent_logs for ${DEMO_EMAIL}`);
    console.log('\nNOTE: All other registered user accounts remain completely untouched.\n');
    console.log('To confirm and execute the reset, run:');
    console.log('   npm run demo:reset -- --yes\n');
    process.exit(0);
  }

  const db = await pool.connect();
  try {
    await db.query('begin');

    // Delete only the demo user (cascades to their clients, invoices, payments, policies, scores)
    await db.query('delete from users where email = $1', [DEMO_EMAIL]);

    // Re-create demo user
    const password_hash = await bcrypt.hash(DEMO_PASSWORD, 10);
    const userRes = await db.query(
      `insert into users (name, email, password_hash, business_name)
       values ($1, $2, $3, $4) returning id`,
      ['Demo Owner', DEMO_EMAIL, password_hash, 'Demo Studio'],
    );
    const userId = userRes.rows[0].id;

    // Re-create default policy
    await db.query(
      `insert into policies (user_id, max_extension_days, max_discount_pct, min_partial_pct, approval_amount_threshold, dry_run)
       values ($1, 14, 10, 25, 50000, true)`,
      [userId],
    );

    // Re-create clients
    const clientIds = [];
    for (const c of clients) {
      const r = await db.query(
        `insert into clients (user_id, name, email, phone, payment_terms_days, notes)
         values ($1, $2, $3, $4, $5, $6) returning id`,
        [userId, c.name, c.email, c.phone, c.terms, c.notes],
      );
      clientIds.push(r.rows[0].id);
    }

    // Re-create invoices & payments
    let invoiceCount = 0;
    let paymentCount = 0;
    for (const inv of invoices) {
      const r = await db.query(
        `insert into invoices
           (user_id, client_id, invoice_no, amount, currency, issue_date, due_date, status, paid_amount)
         values ($1, $2, $3, $4, 'INR', $5, $6, $7, $8) returning id`,
        [userId, clientIds[inv.c], inv.no, inv.amount, offsetDays(inv.issue), offsetDays(inv.due), inv.status, inv.paid],
      );
      invoiceCount += 1;
      if (inv.pay) {
        await db.query(
          `insert into payments (invoice_id, amount, paid_on, method, reference)
           values ($1, $2, $3, $4, $5)`,
          [r.rows[0].id, inv.pay.amount, offsetDays(inv.pay.on), inv.pay.method, inv.pay.ref],
        );
        paymentCount += 1;
      }
    }

    // Re-create scores
    for (let i = 0; i < clientIds.length; i += 1) {
      const s = scores[i];
      await db.query(
        `insert into client_scores (client_id, avg_days_late, on_time_rate, risk_score)
         values ($1, $2, $3, $4)`,
        [clientIds[i], s.avg, s.onTime, s.risk],
      );
    }

    await db.query('commit');
    console.log('✅ Demo reset complete.');
    console.log(`   Owner:    ${DEMO_EMAIL}`);
    console.log(`   Clients:  ${clientIds.length}`);
    console.log(`   Invoices: ${invoiceCount}`);
    console.log(`   Payments: ${paymentCount}`);
  } catch (err) {
    await db.query('rollback').catch(() => {});
    throw err;
  } finally {
    db.release();
  }
}

main()
  .catch((err) => {
    console.error('❌ Demo reset failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
