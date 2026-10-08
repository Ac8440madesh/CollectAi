# CollectAI Architecture & Metric Specifications

CollectAI is an autonomous multi-agent accounts-receivable (AR) platform designed for small businesses and freelancers. It automates invoice monitoring, collection follow-ups, payment plan negotiations, payment reconciliation, and dispute escalations.

---

## 1. System Architecture

```
┌─────────────────────────────────────────────────────────┐
│                 React + Vite Client                     │
│  (Dashboard, Invoices, Agent Activity, Approvals, Sim)  │
└───────────────────────────┬─────────────────────────────┘
                            │ HTTPS / REST (JWT Auth)
┌───────────────────────────▼─────────────────────────────┐
│                      Express API                        │
│  ├── Security: Helmet, CORS, User-Keyed Rate Limiters   │
│  ├── Trust Proxy: Enabled for Render / Vercel Balancers │
│  ├── Per-User Scoping Middleware                        │
│  └── Zod Schema Validation Middleware                   │
└──────┬────────────────────┬──────────────────────┬──────┘
       │                    │                      │
┌──────▼──────┐      ┌──────▼──────┐        ┌──────▼──────┐
│ PostgreSQL  │      │ Agent Engine│        │ LLM Service │
│ (Supabase)  │      │Orchestrator │        │(Anthropic / │
│ Parameterized      │  Pipeline   │        │ Gemini/Mock)│
└─────────────┘      └─────────────┘        └─────────────┘
```

---

## 2. Multi-Agent Team

| Agent | Responsibility | Core Logic & Inputs | Output & Action |
|---|---|---|---|
| **Monitor** | Invoice health scanner | Scans DB for overdue/at-risk invoices ($\le \text{due\_date} + 3\text{d}$). Respects `extended_due_date` and excludes pending `dispute_review` approvals. | Flagged invoices with urgency (`low`, `medium`, `high`, `critical`). |
| **Analyst** | Collection strategist | Enriches flagged invoices with client risk history and scores. | Recommends priority (1–5), tone (`friendly`, `firm`, `final`, `dispute_resolution`), timing, and escalation flag. |
| **Communicator** | Grounded message copywriter | Strictly grounded in DB facts. Groups client invoices into unified messages. | Drafts `{ subject, body }` referencing real invoice numbers and accurate balances. |
| **Negotiator** | Inbound payment negotiator | Analyzes client replies. Inbound text is treated as unexecutable untrusted data. | Classifies intent, drafts counter-offers within policy, or sets `escalate: true`. |
| **Reconciler** | Ledger & payment resolver | Triggered on payment recording. | Settles invoices, closes pending approval chains, and triggers client risk score recomputation. |
| **Escalation** | Human-in-the-loop gate | Flags items violating policy, high-value invoices, or disputes. Explicit `kind` (`dispute_review`, `high_value`, `escalation`). | Creates `approvals` row with clear recommendation for human review. |

---

## 3. Mathematical Metric Specifications & Calculations

### A. Days Sales Outstanding (DSO)
**Definition:** Measures the average number of days it takes for a business to collect payment after a sale has been billed. Lower DSO indicates faster cash conversion.

$$\text{DSO} = \left( \frac{\text{Ending Accounts Receivable Balance}}{\text{Total Billed Credit Sales in Period}} \right) \times 30$$

- **Implementation in `server/src/routes/dashboard.js`:**
  Aggregates monthly credit sales and ending open receivables from database records across the last 6 months.

---

### B. Client Risk Score & On-Time Rate (`services/scoring.js`)
**Definition:** A dynamic 0–100 behavioral rating calculated from historical payment records for each client.

#### 1. Named Constants
- `EXTENSION_ON_TIME_CREDIT = 0.75` ($75\%$ credit awarded when a client pays within an agreed `extended_due_date`).

#### 2. Payment Categories & Credit
When evaluating each **fully settled (`status = 'paid'`)** invoice:
- **Category 1 (On-Time):** $\text{Paid Date} \le \text{Original Due Date} \implies 1.0\text{ credit}$.
- **Category 2 (Within Extension):** $\text{Original Due Date} < \text{Paid Date} \le \text{Extended Due Date} \implies 0.75\text{ credit}$.
- **Category 3 (Late):** $\text{Paid Date} > \text{Effective Due Date} \implies 0.0\text{ credit}$ ($\text{Days Late} = \text{Paid Date} - \text{Effective Due Date}$).

> **Partially paid / overdue / disputed invoices are EXCLUDED from the on-time rate** (they are not yet settled, so they carry no completion credit). However, **they DO affect `risk_score`**: each such active unsettled invoice adds **+10** to the risk score via the Overdue Penalty term below.

#### 3. Rounding Rule (applied consistently)
A single canonical rule is used everywhere: **round-half-up** via `roundHalfUp(n) = Math.round(n)` (JavaScript's `Math.round` rounds halves toward $+\infty$ for positive values). `avg_days_late` is rounded to **2 decimals BEFORE** it feeds the risk formula; `risk_score` is rounded **once at the very end**.

#### 4. Mathematical Formulas
$$\text{On-Time Rate} = \operatorname{roundHalfUp}\left( \frac{\sum \text{Payment Credits (paid invoices only)}}{\text{Count of Paid Invoices}} \times 100 \right)$$

$$\text{Average Days Late} = \operatorname{roundHalfUp}\left(\frac{\sum \text{Days Late}}{\text{Count of Paid Invoices}} \times 100\right) / 100 \quad \text{(2 decimals)}$$

$$\text{Base Risk} = (100 - \text{On-Time Rate}) \times 0.5$$
$$\text{Late Penalty} = \min(\text{Average Days Late} \times 1.5, 30)$$
$$\text{Overdue Penalty} = \text{Count of Overdue/Partial/Disputed (unsettled) Invoices} \times 10$$
$$\text{Risk Score} = \operatorname{clamp}\big(\operatorname{roundHalfUp}(\text{Base Risk} + \text{Late Penalty} + \text{Overdue Penalty}),\ 0,\ 100\big)$$

---

### C. Worked Scoring Examples (from the live demo scenario)

These show the **unrounded** value and the single final `roundHalfUp`:

| Client | Paid Invoices (credit) | On-Time Rate | Avg Days Late | Unrounded Risk | Risk Score |
|---|---|---|---|---|---|
| **Acme Corp** | INV-1001 (0.0), INV-1002 (0.75), INV-1003 (0.0) | $(0.75/3)\times100 = 25\%$ | $(2{+}0{+}2)/3 = 1.33$ | $37.5 + (1.33 \times 1.5) = 37.5 + 1.995 = \mathbf{39.495}$ | $\operatorname{roundHalfUp}(39.495) = \mathbf{39}$ |
| **Globex Pvt Ltd** | INV-2001 (0.0) | $(0/1)\times100 = 0\%$ | $15/1 = 15.00$ | $50 + (15 \times 1.5) = 50 + 22.5 = \mathbf{72.5}$ | $\operatorname{roundHalfUp}(72.5) = \mathbf{73}$ |

> **Why 39.495 rounds to 39 but 72.5 rounds to 73:** these are *not* inconsistent. Acme's unrounded risk is `39.495` (below the `.5` midpoint, so it rounds down to 39), while Globex's is exactly `72.5` (at the midpoint, so round-half-up gives 73). The earlier perceived "39.5 vs 72.5" discrepancy was because Acme's true value is `39.495`, not `39.5`. Both now derive from the single shared `computeScores()` function, so the demo audit table and the live service always match.

---

### D. 30 / 60 / 90-Day Cash-Flow Forecast
**Definition:** A probabilistic inflow forecast projecting anticipated cash receipts over 30, 60, and 90-day future horizons.

$$\text{Projected Inflow} = \sum_{\text{invoices}} \left( \text{Remaining Balance} \times \max\left(\frac{\text{Client On-Time Rate}}{100}, 0.40\right) \right)$$

- Bucketed by effective due date ($\min(\text{due\_date}, \text{extended\_due\_date})$):
  * **1–30 Days:** Invoices due within the next 30 days.
  * **31–60 Days:** Invoices due between 31 and 60 days.
  * **61–90 Days:** Invoices due between 61 and 90 days.

---

### E. Agent Autonomy Rate
**Definition:** Percentage of operational decisions executed autonomously without requiring human intervention in the Approvals queue.

$$\text{Autonomy Rate} = \left( \frac{\text{Auto-Sent Messages}}{\text{Auto-Sent Messages} + \text{Escalated Approvals}} \right) \times 100$$

---

## 4. Guardrails & Security Architecture

1. **Prompt Injection Defense:** Inbound text is enclosed in `<client_message>` tags and treated as pure passive data. System prompts and server-side validators reject instruction overrides.
2. **Server-Side Policy Overrides:** Policy limits (e.g. `max_extension_days`, `max_discount_pct`, `min_partial_pct`) are enforced in deterministic server code after the LLM returns, overriding any hallucinated flags.
3. **Pessimistic Concurrency Locking:** `SELECT ... FOR UPDATE` inside dedicated database connection transactions prevents race conditions on payments and approval decisions.
4. **Timezone-Aware Rate Limiting:** Enforces maximum 1 reminder per 3 days per client, and validates operating hours in `Asia/Kolkata` (9:00 AM – 6:00 PM IST) in live mode.
5. **Approvals Classification (`kind`):** Explicit `kind` tags (`dispute_review`, `high_value`, `escalation`) ensure dispute reviews mute automated collection reminders until human resolution.
