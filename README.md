# CollectAI — Autonomous Accounts-Receivable Agent Team

> Autonomous multi-agent accounts-receivable (AR) intelligence for small businesses and freelancers. CollectAI monitors unpaid invoices, decides how to follow up, drafts grounded communications, negotiates payment plans within owner-set limits, reconciles payments, and escalates risky cases with human-in-the-loop guardrails.

Built for the **Agentic AI & Intelligent Systems** hackathon theme.

---

## 📑 Table of Contents
- [Problem Statement](#-problem-statement)
- [Architecture & Workflow](#-architecture--workflow)
- [Agent Team Breakdown](#-agent-team-breakdown)
- [Key Features & Guardrails](#-key-features--guardrails)
- [Tech Stack](#-tech-stack)
- [Quick Start (Local Setup)](#-quick-start-local-setup)
- [Demo Credentials & Golden Path](#-demo-credentials--golden-path)
- [API Summary](#-api-summary)
- [Step-by-Step Deployment Guide](#-step-by-step-deployment-guide)
- [Limitations & Future Roadmap](#-limitations--future-roadmap)

---

## 🎯 Problem Statement

Small businesses and freelancers in India often wait **45 to 90+ days** to get paid. Chasing invoices manually across disconnected spreadsheets, emails, and chats leads to:
1. **Inconsistent follow-up tone** that strains client relationships.
2. **Lack of credit intelligence**: nobody tracks which clients pay late, why they pay late, or their risk profile.
3. **Severe working-capital crunch** and unpredictable cash flow.

**CollectAI** solves this by acting as an autonomous accounts-receivable department that operates 24/7 with strict human guardrails.

---

## 🏗️ Architecture & Workflow

```
┌────────────────────────────────────────────────────────────────────────┐
│                        React + Vite Dashboard                          │
│     (KPIs, Recharts DSO Trend, Forecast, Approvals, Simulator)         │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ HTTPS / JSON (JWT Auth)
┌───────────────────────────────────▼────────────────────────────────────┐
│                              Express API                               │
│  ├── Security: Helmet, CORS, User-Keyed Rate Limiters, Trust Proxy     │
│  ├── Multi-Tenant Scoping Middleware (user_id isolation)               │
│  └── Zod Schema Validation Middleware                                  │
└─────────┬─────────────────────────┬────────────────────────────┬───────┘
          │                         │                            │
┌─────────▼──────────┐   ┌──────────▼──────────┐   ┌─────────────▼───────┐
│     PostgreSQL     │   │   Agent Orchestrator│   │     LLM Service     │
│  (Supabase / pg)   │   │  ├── Monitor        │   │ ├── Claude API      │
│ ├── Parameterized  │   │  ├── Analyst        │   │ ├── Gemini API      │
│ └── SELECT FOR     │   │  ├── Communicator   │   │ └── Zero-Key Mock   │
│     UPDATE Locking │   │  ├── Negotiator     │   └─────────────────────┘
└────────────────────┘   │  ├── Reconciler     │
                         │  └── Escalation     │
                         └─────────────────────┘
```

### Orchestrator Pipeline Cycle:
$$\text{Monitor} \longrightarrow \text{Analyst} \longrightarrow \text{Client Grouping} \longrightarrow \text{Communicator} \longrightarrow \text{Guardrails} \longrightarrow \left[ \begin{array}{l} \text{Auto-Sent (Dry Run)} \\ \text{Approvals Queue} \end{array} \right]$$

---

## 🤖 Agent Team Breakdown

| Agent | Responsibility | Core Logic & Inputs | Output & Action |
|---|---|---|---|
| **Monitor** | Invoice health scanner | Scans DB for overdue/at-risk invoices ($\le \text{due\_date} + 3\text{d}$). Respects `extended_due_date` and mutes active dispute reviews. | Flagged invoices categorized by urgency (`low`, `medium`, `high`, `critical`). |
| **Analyst** | Collection strategist | Enriches flagged invoices with client risk scores and payment histories. | Recommends priority (1–5), tone (`friendly`, `firm`, `final`, `dispute_resolution`), timing, and escalation flag. |
| **Communicator** | Grounded message copywriter | Strictly grounded in DB facts. Bundles multiple invoices per client into a single unified message. | Drafts `{ subject, body }` referencing real invoice numbers and accurate balances. |
| **Negotiator** | Inbound payment negotiator | Analyzes client replies. Inbound text is treated as unexecutable untrusted data. | Classifies intent, drafts counter-offers within policy, or sets `escalate: true`. |
| **Reconciler** | Ledger & payment resolver | Triggered on payment recording. | Settles invoices, closes pending approval chains, and triggers client risk score recomputation. |
| **Escalation** | Human-in-the-loop gate | Flags items violating policy, high-value invoices, or disputes with explicit `kind`. | Creates `approvals` row with clear recommendation for human review. |

---

## 🛡️ Key Features & Guardrails

1. **Strict Grounding & Zero Hallucination Validator (`services/validators.js`)**:
   - Before any reminder is saved or dispatched, the Draft Validator verifies that all invoice numbers and exact balances match the database.
   - If a draft fails validation, the system retries once with validation errors attached; if it fails again, it safely routes to human review.
2. **Prompt Injection Defense**:
   - Inbound client text is isolated in `<client_message>` tags and treated as passive conversational text. Instruction overrides and unauthorized debt waiver attempts are defended and escalated immediately.
3. **Deterministic Server-Side Policy Overrides**:
   - Owner-set limits (`max_extension_days`, `max_discount_pct`, `min_partial_pct`, `approval_amount_threshold`) are enforced in deterministic server code after LLM return, overriding any hallucinated flags.
4. **Pessimistic Concurrency Locking**:
   - `SELECT ... FOR UPDATE` inside dedicated database transactions prevents race conditions on payments and approval decisions.
5. **Dynamic Client Risk Scoring (`services/scoring.js`)**:
   - Awards full credit for on-time payments and $75\%$ credit for payments settled within agreed extensions (`EXTENSION_ON_TIME_CREDIT = 0.75`).
   - Unpaid overdue/disputed invoices raise the client's risk score.

---

## 💻 Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | React 18, Vite, React Router v6, Tailwind CSS, Axios, Recharts |
| **Backend** | Node.js 20+, Express.js, JWT, bcryptjs, Zod, node-cron, Multer |
| **Database** | PostgreSQL (Supabase in production/dev), `pg` connection pool with SSL (No ORM) |
| **AI / LLM** | Single LLM abstraction (`services/llm.js`) supporting Anthropic, Gemini, and **Deterministic Mock Mode** |

---

## 🚀 Quick Start (Local Setup)

### 1. Prerequisites
- **Node.js 20+** and **npm** installed.
- A PostgreSQL / Supabase connection string.

### 2. Backend Setup
```bash
cd server
cp .env.example .env
```
Edit `server/.env` with your credentials:
```env
PORT=4000
NODE_ENV=development
DATABASE_URL=postgresql://postgres:[password]@db.[ref].supabase.co:5432/postgres
JWT_SECRET=your-random-32-character-secret-key-here
JWT_EXPIRES_IN=7d
FRONTEND_ORIGIN=http://localhost:5173
LLM_PROVIDER=anthropic
LLM_MODE=mock
```
Install dependencies, initialize schema, and seed demo data:
```bash
npm install
npm run db:init      # Creates tables & runs idempotent column migrations
npm run seed         # Seeds demo owner, 5 clients, 14 invoices, payments, and scores
npm run dev          # Starts Express API at http://localhost:4000
```

### 3. Frontend Setup (Separate Terminal)
```bash
cd client
cp .env.example .env
npm install
npm run dev          # Starts Vite dashboard at http://localhost:5173
```

### 4. Run Automated Tests
```bash
cd server
npm test             # Runs all 88 Vitest test suites across auth, CRUD, agents, and scoring
```

---

## 🔑 Demo Credentials & Golden Path

- **URL:** `http://localhost:5173`
- **Email:** `demo@collectai.app`
- **Password:** `demo1234`

### Rehearsing the Demo Offline:
You can reset the database and run the complete end-to-end golden path with one command:
```bash
cd server
npm run demo:reset -- --yes  # Cleanly restores demo data without touching other users
npm run scenario:test        # Executes full E2E scenario in mock mode
```

---

## 📡 API Summary

All endpoints live under `/api` and require `Authorization: Bearer <token>` (except `/api/auth/register`, `/api/auth/login`, and `/api/health`):

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/health` | Service health check |
| `POST` | `/api/auth/register` | Register new user + default policy |
| `POST` | `/api/auth/login` | Authenticate user & return JWT |
| `GET` | `/api/auth/me` | Fetch authenticated user profile |
| `GET` / `POST` | `/api/clients` | List & create clients (scoped by user) |
| `PUT` / `DELETE`| `/api/clients/:id` | Update / delete client |
| `GET` / `POST` | `/api/invoices` | List & create invoices with status filters |
| `POST` | `/api/invoices/import`| Multipart CSV import (Multer) |
| `POST` | `/api/payments` | Record payment & trigger Reconciler agent |
| `POST` | `/api/agents/run` | Trigger full multi-agent orchestrator cycle |
| `POST` | `/api/agents/cron-trigger` | External-pinger trigger (requires `CRON_SECRET` header) |
| `GET` | `/api/agents/logs` | Query paginated agent audit logs |
| `GET` | `/api/approvals` | List pending approvals queue |
| `POST` | `/api/approvals/:id/decide`| Approve, reject, or edit & approve item |
| `POST` | `/api/communications/inbound`| Simulate client reply -> Negotiator evaluation |
| `GET` / `PUT` | `/api/policy` | Fetch & update owner policy guardrails |
| `GET` | `/api/dashboard/summary`| Fetch AR metrics, DSO trend, and 30/60/90 forecast |
| `GET` | `/api/dashboard/invoices/:id/timeline` | Fetch complete unified invoice timeline |

---

## 🌐 Step-by-Step Deployment Guide

### A. Database (Supabase)
1. Create a project at [supabase.com](https://supabase.com).
2. Under **Project Settings → Database → Connection string**, copy the **Session pooler** string (IPv4-friendly, port `5432`).
3. Run `npm run db:init` from your local machine (or paste `server/sql/schema.sql` into the Supabase SQL Editor).

### B. Backend (Render)
1. Create a new **Web Service** on [render.com](https://render.com) connected to your GitHub repository.
2. Configure settings:
   - **Root Directory:** `server`
   - **Environment:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Health Check Path:** `/api/health`
3. Add Environment Variables on Render:
   - `DATABASE_URL`: Your Supabase connection string.
   - `JWT_SECRET`: Random 32+ character string.
   - `JWT_EXPIRES_IN`: `7d`
   - `FRONTEND_ORIGIN`: Your deployed Vercel URL (e.g. `https://collectai.vercel.app`).
   - `LLM_PROVIDER`: `anthropic` (or `gemini`).
   - `LLM_MODE`: `mock` (or `live` with `LLM_API_KEY`).
   - `NODE_ENV`: `production`
   - `ENABLE_CRON_JOBS`: `true`
   - `CRON_SECRET`: Random secret token required by the external cron-trigger endpoint.

> ⏰ **Scheduled Jobs & Free-Tier Idle Sleeping:** CollectAI includes an in-process `node-cron` scheduler (`ENABLE_CRON_JOBS=true`). **However, Render's free tier spins down the instance after ~15 minutes of inactivity, which pauses all in-memory cron timers** — so the daily job will not fire reliably on free-tier. For the hackathon demo, the **manual "Run Agents Now" button** on the Agent Activity page is the reliable path. For true scheduled automation, point an external pinger (e.g. [cron-job.org](https://cron-job.org), Upstash QStash, or GitHub Actions) at the protected endpoint:
> ```
> POST https://<your-render-url>/api/agents/cron-trigger
> Authorization: Bearer <JWT>
> x-cron-secret: <CRON_SECRET>
> ```
> This wakes the instance and triggers the orchestrator. The endpoint requires both a valid user JWT and the `CRON_SECRET` header (constant-time compared), is rate-limited, and returns `503` when `CRON_SECRET` is unset.

> ⚠️ **Free-Tier Cold Start Notice:** Render free-tier instances sleep after inactivity and take ~50 seconds to spin up. Before starting your hackathon presentation or demo recording, hit `https://<your-render-url>/api/health` in your browser to warm up the instance.

### C. Frontend (Vercel)
1. Import your GitHub repository on [vercel.com](https://vercel.com).
2. Configure settings:
   - **Root Directory:** `client`
   - **Framework Preset:** `Vite`
   - **Build Command:** `npm run build`
   - **Output Directory:** `dist`
3. Add Environment Variable:
   - `VITE_API_URL`: `https://<your-render-url>/api`
4. The repository includes [`client/vercel.json`](client/vercel.json) with SPA rewrites for React Router.

---

## 🔮 Limitations & Future Roadmap
- **Live WhatsApp Integration**: Connect WhatsApp Business API alongside email.
- **Automated Bank Reconciliation**: Integrate Open Banking / UPI webhooks for automatic payment ingestion.
- **Multilingual Support**: Support Hindi, Tamil, Telugu, and Kannada regional language follow-ups.
