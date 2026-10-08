/**
 * Seed demo data.
 *   npm run seed
 *
 * Creates ONE demo owner with 5 clients (different payment behaviours) and 14
 * invoices spanning paid / pending / overdue / partial / disputed, plus payment
 * history and client scores — so the dashboard and agents have data to work
 * with. Re-runnable: it deletes the existing demo owner (cascade) first.
 *
 * Demo login:  demo@collectai.app  /  demo1234
 */
import bcrypt from 'bcryptjs';
import { pool } from '../src/config/db.js';

const DEMO_EMAIL = 'demo@collectai.app';
const DEMO_PASSWORD = 'demo1234';

// --- date helpers -----------------------------------------------------------
const iso = (d) => d.toISOString().slice(0, 10);
function offsetDays(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return iso(d);
}

// --- seed data ---------------------------------------------------------------
const clients = [
  { name: 'Acme Corp', email: 'acme@example.com', phone: '9000000001', terms: 30, notes: 'Reliable, pays on time.' },
  { name: 'Globex Pvt Ltd', email: 'billing@globex.example', phone: '9000000002', terms: 45, notes: 'Usually a few weeks late.' },
  { name: 'Initech Solutions', email: 'accounts@initech.example', phone: '9000000003', terms: 30, notes: 'Chronic late payer.' },
  { name: 'Umbrella Traders', email: 'finance@umbrella.example', phone: '9000000004', terms: 15, notes: 'Occasionally disputes invoices.' },
  { name: 'Wayne Enterprises', email: 'ap@wayne.example', phone: '9000000005', terms: 60, notes: 'Large contracts, slow cycle.' },
];

// c = client index. offsets are days relative to today (negative = past).
const invoices = [
  { c: 0, no: 'INV-1001', amount: 25000, issue: -60, due: -30, status: 'paid',     paid: 25000, pay: { amount: 25000, on: -28, method: 'upi',  ref: 'UPI-1001' } },
  { c: 0, no: 'INV-1002', amount: 18000, issue: -20, due: 10,  status: 'pending',  paid: 0 },
  { c: 0, no: 'INV-1003', amount: 32000, issue: -90, due: -60, status: 'paid',     paid: 32000, pay: { amount: 32000, on: -58, method: 'bank', ref: 'NEFT-1003' } },
  { c: 1, no: 'INV-2001', amount: 54000, issue: -75, due: -30, status: 'overdue',  paid: 0 },
  { c: 1, no: 'INV-2002', amount: 40000, issue: -50, due: -5,  status: 'partial',  paid: 15000, pay: { amount: 15000, on: -10, method: 'upi',  ref: 'UPI-2002' } },
  { c: 2, no: 'INV-3001', amount: 22000, issue: -120, due: -90, status: 'overdue', paid: 0 },
  { c: 2, no: 'INV-3002', amount: 15000, issue: -80, due: -50, status: 'overdue',  paid: 0 },
  { c: 2, no: 'INV-3003', amount: 12000, issue: -100, due: -70, status: 'paid',    paid: 12000, pay: { amount: 12000, on: -40, method: 'cash', ref: 'CASH-3003' } },
  { c: 3, no: 'INV-4001', amount: 30000, issue: -40, due: -25, status: 'disputed', paid: 0 },
  { c: 3, no: 'INV-4002', amount: 9000,  issue: -10, due: 5,   status: 'pending',  paid: 0 },
  { c: 4, no: 'INV-5001', amount: 150000, issue: -30, due: 30, status: 'pending',  paid: 0 },
  { c: 4, no: 'INV-5002', amount: 220000, issue: -90, due: -30, status: 'overdue', paid: 0 },
  { c: 4, no: 'INV-5003', amount: 180000, issue: -75, due: -15, status: 'partial', paid: 90000, pay: { amount: 90000, on: -20, method: 'bank', ref: 'NEFT-5003' } },
  { c: 4, no: 'INV-5004', amount: 120000, issue: -120, due: -60, status: 'paid',   paid: 120000, pay: { amount: 120000, on: -62, method: 'bank', ref: 'NEFT-5004' } },
];

// avg_days_late, on_time_rate (0-100), risk_score (0-100) per client index.
const scores = [
  { avg: 1.5, onTime: 95, risk: 12 },
  { avg: 20, onTime: 55, risk: 55 },
  { avg: 45, onTime: 20, risk: 85 },
  { avg: 15, onTime: 40, risk: 70 },
  { avg: 25, onTime: 50, risk: 60 },
];

async function main() {
  const db = await pool.connect();
  try {
    await db.query('begin');

    // Fresh start for the demo owner (cascades to all their data).
    await db.query('delete from users where email = $1', [DEMO_EMAIL]);

    const password_hash = await bcrypt.hash(DEMO_PASSWORD, 10);
    const userRes = await db.query(
      `insert into users (name, email, password_hash, business_name)
       values ($1, $2, $3, $4) returning id`,
      ['Demo Owner', DEMO_EMAIL, password_hash, 'Demo Studio'],
    );
    const userId = userRes.rows[0].id;

    await db.query(
      `insert into policies (user_id, max_extension_days, max_discount_pct, min_partial_pct, approval_amount_threshold, dry_run)
       values ($1, 14, 10, 25, 50000, true)`,
      [userId],
    );

    const clientIds = [];
    for (const c of clients) {
      const r = await db.query(
        `insert into clients (user_id, name, email, phone, payment_terms_days, notes)
         values ($1, $2, $3, $4, $5, $6) returning id`,
        [userId, c.name, c.email, c.phone, c.terms, c.notes],
      );
      clientIds.push(r.rows[0].id);
    }

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

    for (let i = 0; i < clientIds.length; i += 1) {
      const s = scores[i];
      await db.query(
        `insert into client_scores (client_id, avg_days_late, on_time_rate, risk_score)
         values ($1, $2, $3, $4)`,
        [clientIds[i], s.avg, s.onTime, s.risk],
      );
    }

    await db.query('commit');
    console.log('✅ Seed complete.');
    console.log(`   owner:    ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
    console.log(`   clients:  ${clientIds.length}`);
    console.log(`   invoices: ${invoiceCount}`);
    console.log(`   payments: ${paymentCount}`);
  } catch (err) {
    await db.query('rollback').catch(() => {});
    throw err;
  } finally {
    db.release();
  }
}

main()
  .catch((err) => {
    console.error('❌ Seed failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
