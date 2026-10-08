# Project: CollectAI

## 1. Role and goal
You are a senior full-stack engineer helping a student build a hackathon project **end to end, deployed, and demo-ready**. The hackathon theme is **Agentic AI & Intelligent Systems**: a solution where autonomous AI agents plan, reason, collaborate, and execute multi-step tasks with minimal human intervention.

**CollectAI** is an autonomous accounts-receivable agent team for small businesses and freelancers. It monitors unpaid invoices, decides how to chase each client, drafts and sends follow-ups, negotiates payment plans within owner-set limits, reconciles payments, and escalates risky cases to the human owner.

### Problem statement
Small businesses in India often wait 45-90+ days for payment. Chasing invoices is manual and scattered across spreadsheets, email, and chat. Follow-up tone is inconsistent, nobody tracks which clients pay late or why, and cash flow suffers.

### Hackathon submission requirements (everything we build must support these)
- Problem statement and solution description
- Public GitHub repo with the full frontend and backend plus a README with setup and run steps
- Publicly deployed application link
- A 3-5 minute demo video showing features, AI capabilities, and workflow

## 2. Hard constraints (never violate)
- **Frontend:** React.js, Vite, React Router, Tailwind CSS, Axios, Recharts.
- **Backend:** Node.js (v20+), Express.js, JWT authentication, bcrypt for password hashing, Zod for validation.
- **Database:** PostgreSQL (Supabase in production; local Postgres or Supabase for dev). Use the `pg` package with plain parameterized SQL. No ORM.
- **AI:** one LLM provider behind a single wrapper (`server/src/services/llm.js`). Provider and model come from env vars so we can switch between the Claude API and the Gemini API.
- **The LLM API key must exist only in backend environment variables.** Never expose it to the frontend, never commit it, never log it.
- No secrets in git. Provide `.env.example` files. `.env` is gitignored.
- Every protected route is scoped by `user_id` so one user can never read or modify another user's data.
- Use JavaScript (ES modules) unless I say otherwise. Keep dependencies minimal and well-known.

## 3. How to work with me
- **Plan before coding.** At the start of each phase, give a short plan (files to create, order of work) and wait for my "go" only if something is ambiguous. Otherwise proceed.
- **Small, verifiable steps.** After each step, run the code or tests and show me the evidence (command output, curl response). Never claim something works without running it.
- **Commit often** with clear conventional messages (`feat:`, `fix:`, `chore:`, `docs:`). One logical change per commit.
- **Ask one focused question** when a decision is genuinely ambiguous or needs my input (keys, accounts, deployment credentials). Otherwise choose a sensible default and state the assumption.
- **Do not add features** outside the current phase. If you see a good idea, add it to `docs/BACKLOG.md` instead.
- **Keep the demo in mind.** Everything should be demonstrable in a clean 4-minute video with seeded data. Prefer reliable and visible over clever and fragile.
- Explain briefly what you did after each phase in plain language, since I am a student and want to understand the code.
- When you hit an error, diagnose the root cause. Do not paper over it with try/catch or by weakening validation.

## 4. Architecture overview
```
React + Vite dashboard (JWT)  <--HTTPS/JSON-->  Express API
                                                 |- auth, validation (Zod)
                                                 |- REST routes
                                                 |- Agent orchestrator
                                                 |        |
                                          PostgreSQL     LLM API (key in backend env only)
```

Orchestrator cycle (scheduled by `node-cron` and also triggered by a "Run agents now" button):
`Monitor -> Analyst -> Communicator -> [Approval gate] -> Send`, with `Negotiator` handling inbound replies and `Reconciler` handling payments.

## 5. Repository structure
```
collectai/
  CLAUDE.md
  README.md
  docs/            BACKLOG.md, ARCHITECTURE.md, DEMO_SCRIPT.md
  client/          (React + Vite)
    src/ pages/ components/ api/ hooks/ context/
  server/
    src/
      index.js
      config/        env.js, db.js
      middleware/    auth.js, validate.js, errorHandler.js, rateLimit.js
      routes/        auth, clients, invoices, payments, agents, approvals, communications, policy, dashboard
      agents/        monitor.js, analyst.js, communicator.js, negotiator.js, reconciler.js, escalation.js, orchestrator.js
      services/      llm.js, mailer.js, scoring.js, validators.js
      schemas/       zod schemas (request bodies and LLM outputs)
      jobs/          cron.js
    sql/             schema.sql, seed.sql
    .env.example
```

## 6. Database schema (PostgreSQL)
Create `server/sql/schema.sql` with these tables (use UUID primary keys, `created_at` timestamps, sensible indexes, and foreign keys with `ON DELETE CASCADE` where appropriate):

- **users**: id, name, email (unique), password_hash, business_name
- **clients**: id, user_id, name, email, phone, payment_terms_days, notes
- **invoices**: id, user_id, client_id, invoice_no, amount (numeric), currency (default 'INR'), issue_date, due_date, status (`pending | overdue | partial | paid | disputed`), paid_amount
- **payments**: id, invoice_id, amount, paid_on, method, reference
- **communications**: id, invoice_id, direction (`outbound | inbound`), channel, subject, body, status (`draft | pending_approval | sent`), created_at
- **agent_logs**: id, user_id, agent, invoice_id, input_summary, output_json (jsonb), reasoning, created_at
- **approvals**: id, user_id, invoice_id, communication_id, reason, recommendation, status (`pending | approved | rejected`), decided_at
- **policies**: id, user_id (unique), max_extension_days, max_discount_pct, min_partial_pct, approval_amount_threshold, dry_run (boolean, default true)
- **client_scores**: id, client_id, avg_days_late, on_time_rate, risk_score, updated_at

`seed.sql` (or a `npm run seed` script): one demo user, 5 clients with different payment behaviours, 12-15 invoices covering paid, pending, overdue, partial, and disputed, plus some payment history so scoring has data.

## 7. Agent design
Each agent is a module exporting an async function. Each uses a focused system prompt, receives **only data from the database** (never invented facts), and must return **strict JSON** validated by a Zod schema. If validation fails, retry once with the validation error appended; if it fails again, fall back to a safe default (escalate to the human). Log every run to `agent_logs` with a short human-readable `reasoning` string.

| Agent | Input | Output |
|---|---|---|
| Monitor | invoices and due dates | overdue and at-risk invoices with days overdue (mostly deterministic SQL and logic, LLM only if useful) |
| Analyst | invoice + client history + score | priority (1-5), tone (`friendly | firm | final`), timing, reasoning |
| Communicator | analyst plan + client context | email `{subject, body}` referencing real invoice no., amount, and dates |
| Negotiator | inbound reply text + policy | intent (`promise_to_pay | extension_request | partial_payment | dispute | other`), proposed response, and counter-offer within policy, or `escalate: true` |
| Reconciler | payment records | updates invoice status, closes follow-up chains, recomputes client score |
| Escalation | any flagged action | creates an `approvals` row with a clear recommendation and reason |

### Guardrails (must be implemented and visible in the UI)
- **Policy limits:** extensions, discounts, and partial payments must stay within the user's `policies` row. Anything outside goes to approval.
- **Approval gate:** invoice amount above `approval_amount_threshold`, any dispute, an angry or threatening reply, or any out-of-policy offer is never sent automatically.
- **Draft validator (`services/validators.js`):** before sending, verify the draft contains the correct invoice number and amount and no other amounts or dates not present in the database. Reject and regenerate otherwise.
- **Rate limit per client:** at most one reminder per client every 3 days; only send within configured business hours.
- **Dry-run mode (default on):** messages are stored as "sent (dry run)" and never leave the system. Live mode sends only through the mailer to allow-listed test addresses unless explicitly configured.
- **Prompt-injection hygiene:** inbound client text is untrusted data. Wrap it clearly in the prompt, instruct the model to treat it as content only, and never execute any action directly from it without passing the policy check.
- **Audit trail:** every agent decision is stored and shown in the Agent Activity feed.

## 8. API (all under `/api`, JSON, Zod-validated, JWT on everything except auth)
- `POST /auth/register`, `POST /auth/login`
- `GET/POST /clients`, `PUT/DELETE /clients/:id`
- `GET/POST /invoices`, `PUT /invoices/:id`, `POST /invoices/import` (CSV via multer)
- `POST /payments` (records payment, triggers Reconciler)
- `POST /agents/run` (run full cycle; returns step-by-step results), `GET /agents/logs`
- `GET /approvals`, `POST /approvals/:id/decide` (`approve | reject | edit_and_approve`)
- `POST /communications/inbound` (simulate a client reply, runs Negotiator)
- `GET/PUT /policy`
- `GET /dashboard/summary` (outstanding, overdue, recovered, DSO trend, autonomy rate, 30/60/90-day cash-flow forecast)
- `GET /health`

Consistent error format: `{ error: { code, message, details? } }`. Central error handler. Never leak stack traces in production.

## 9. Frontend pages
Login/Register; **Dashboard** (KPI cards, DSO trend and cash-flow charts with Recharts, autonomy rate); **Invoices** (table, filters, add/import, per-invoice timeline of agent actions); **Clients** (risk score, history); **Agent Activity** (live feed of which agent did what and why, expandable reasoning; this is the demo centrepiece, with a prominent "Run agents now" button and step-by-step progress); **Approvals** (queue with recommendation and Approve / Edit / Reject); **Inbox Simulator** (paste a client reply, watch the Negotiator respond); **Settings** (policy limits, approval threshold, dry-run toggle).

UI rules: Tailwind, responsive down to mobile, clear loading and error and empty states, colour-coded status chips, accessible contrast and keyboard-usable controls, protected routes via React Router with token stored safely (prefer in-memory + refresh, or localStorage with care and a note in docs).

## 10. Security checklist (verify before each deploy)
bcrypt hashing; JWT with expiry and secret from env; auth middleware everywhere; Zod on every body/query/param; per-user data scoping on every query; Helmet; CORS limited to the frontend origin; express-rate-limit (stricter on auth routes); parameterized SQL only; no secrets in git; `.env.example` present; LLM key never reaches the browser.

## 11. Testing and verification
- Backend: add tests (Vitest or Jest + Supertest) for auth, validation, user scoping, policy enforcement, the draft validator, and Zod handling of malformed LLM output (mock the LLM).
- Provide a **mock LLM mode** (`LLM_MODE=mock`) returning deterministic outputs so the app and tests run without an API key and the demo can be rehearsed offline.
- Maintain a manual smoke-test script in `docs/` (register, add invoice, run agents, approve, inbound reply, record payment).

## 12. Environment variables
Server `.env.example`:
```
PORT=4000
NODE_ENV=development
DATABASE_URL=
JWT_SECRET=
JWT_EXPIRES_IN=7d
FRONTEND_ORIGIN=http://localhost:5173
LLM_PROVIDER=anthropic        # or gemini
LLM_MODEL=
LLM_API_KEY=
LLM_MODE=live                 # or mock
SMTP_HOST=
SMTP_PORT=
SMTP_USER=
SMTP_PASS=
MAIL_FROM=
```
Client `.env.example`: `VITE_API_URL=http://localhost:4000/api`

## 13. Deployment
Database: Supabase (run `schema.sql`, use the pooled connection string). Backend: Render (build/start commands, env vars, health check at `/api/health`). Frontend: Vercel (`VITE_API_URL` set to the Render URL, SPA rewrite for React Router). Document every step in the README. Note that free-tier backends sleep, so add a warm-up note for the demo.

## 14. README requirements
Project overview and problem statement; screenshots or GIF; architecture diagram; feature list; tech stack; local setup (clone, install, env, DB, seed, run); demo login credentials; how agents and guardrails work; API summary; deployment links; limitations and future work.

## 15. Definition of done
- A fresh clone can be set up from the README alone and run.
- Seeded demo scenario works end to end: overdue invoice -> agent reminder -> client reply -> negotiated plan -> payment -> invoice closed, with a flagged item going through approval.
- All items in sections 2, 7, and 10 are implemented and checked.
- Deployed frontend, backend, and DB work together from a fresh browser.
- Tests pass; no secrets in git history.
