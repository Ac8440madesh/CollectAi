# Build phases

The phased plan for CollectAI. Review, run, and commit before moving to the next phase.
(Preserved from the original master prompt so every session shares the same roadmap.)

## Phase 0: Scaffold
Scaffold the repo per `CLAUDE.md` §5. Initialize git, `.gitignore`, client (Vite + React +
Tailwind + React Router + Axios) and server (Express, ES modules, env config with validation
via Zod, Helmet, CORS, rate limiting, error handler, `/api/health`). Add `.env.example` files,
a root README stub, and `docs/BACKLOG.md`. Verify both apps start and `/api/health` responds.
Commit.

## Phase 1: Database and auth
Write `server/sql/schema.sql` and a seed script (§6). Add `db.js` using `pg` with a connection
pool. Implement register/login with bcrypt + JWT, auth middleware, and Zod validation
middleware. Add tests for auth and validation. Build Login/Register pages with protected
routes. Prove register, login, and a protected route work. Commit.

## Phase 2: Core CRUD and first agents
Implement clients, invoices (including CSV import), and payments routes with per-user scoping
and tests. Build `services/llm.js` (provider switch, mock mode, JSON-output helper with Zod
validation and one retry). Implement the Monitor and Analyst agents and a minimal orchestrator
that logs to `agent_logs`. Add `POST /agents/run` and `GET /agents/logs`. Build the Invoices
page and a basic Agent Activity page. Prove it with mock mode and show the logs.

## Phase 3: Messaging, guardrails, approvals
Implement the Communicator agent, `services/validators.js` (draft validator), mailer with
dry-run default, policy routes and Settings page, the Escalation agent, approval gate rules
from §7, and the Approvals page. Add tests for policy enforcement, the validator, and rate
limiting per client. Show a scenario where a small invoice is auto-processed and a large one
lands in approvals.

## Phase 4: Negotiation, reconciliation, dashboard
Implement the Negotiator (intent classification + in-policy counter-offer or escalation),
`POST /communications/inbound`, the Inbox Simulator page, the Reconciler (updates status,
recomputes `client_scores` via `services/scoring.js`), and `GET /dashboard/summary` with DSO
trend, cash-flow forecast, and autonomy rate. Build the Dashboard with Recharts. Add the
per-invoice timeline. Run the full seeded scenario end to end in mock mode and in live mode if
a key is available.

## Phase 5: Polish, deploy, document
Polish UI states (loading, error, empty), mobile responsiveness, and accessibility basics. Run
the §10 security checklist and fix gaps. Prepare deployment configs and step-by-step deployment
docs (Supabase, Render, Vercel). Write the full README (§14), `docs/ARCHITECTURE.md`, and
`docs/DEMO_SCRIPT.md` (4-minute script matching the app). Do a final fresh-clone setup test and
report results. **Do NOT deploy anything without asking;** provide exact steps and env var list.

## Handy follow-ups
- Review the whole repo for bugs, security issues, and mismatches with `CLAUDE.md`.
- Explain the orchestrator and one agent file like I'm a student seeing it for the first time.
- Tighten agent system prompts: list failure cases (hallucinated amounts, wrong tone, prompt
  injection) and add test cases for each.
