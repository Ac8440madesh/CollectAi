# CollectAI

> Autonomous accounts-receivable (AR) agent team for small businesses and freelancers.

CollectAI monitors unpaid invoices, decides how to chase each client, drafts and sends
follow-ups, negotiates payment plans **within owner-set limits**, reconciles payments, and
escalates risky cases to the human owner — with a full audit trail and human-in-the-loop
guardrails.

Built for the **Agentic AI & Intelligent Systems** hackathon theme.

> ⚠️ **Status: Phase 0 (scaffold).** This README is a stub and will be completed in Phase 5
> with full setup, screenshots, architecture, demo credentials, and deployment links.

## Tech stack

| Layer    | Tech |
|----------|------|
| Frontend | React, Vite, React Router, Tailwind CSS, Axios, Recharts |
| Backend  | Node.js 20+, Express, JWT, bcrypt, Zod |
| Database | PostgreSQL (`pg`, parameterized SQL — no ORM) |
| AI       | Single LLM wrapper (Anthropic / Gemini), with a deterministic **mock mode** |

## Repository layout

```
collectai/
  CLAUDE.md          # project spec and working agreement (read every session)
  README.md
  docs/              # BACKLOG, PHASES, (later) ARCHITECTURE, DEMO_SCRIPT
  client/            # React + Vite dashboard
  server/            # Express API + agent orchestrator
```

## Quick start (dev)

> Full instructions land in Phase 5. For now:

```bash
# Backend
cd server
cp .env.example .env   # fill in values; LLM_MODE=mock works with no API key
npm install
npm run dev            # http://localhost:4000  (health: /api/health)

# Frontend (separate terminal)
cd client
cp .env.example .env
npm install
npm run dev            # http://localhost:5173
```

## License

Hackathon project — not yet licensed.
