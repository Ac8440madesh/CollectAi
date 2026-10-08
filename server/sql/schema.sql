-- CollectAI schema (PostgreSQL / Supabase)
-- Run once per environment:  npm run db:init   (or paste into the Supabase SQL Editor)
-- Idempotent: safe to run more than once.

-- gen_random_uuid() is built into Postgres 13+; this is a harmless safety net.
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------
create table if not exists users (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  email         text not null unique,
  password_hash text not null,
  business_name text,
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- clients  (belongs to a user)
-- ---------------------------------------------------------------------------
create table if not exists clients (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references users(id) on delete cascade,
  name               text not null,
  email              text,
  phone              text,
  payment_terms_days integer not null default 30,
  notes              text,
  created_at         timestamptz not null default now()
);
create index if not exists idx_clients_user on clients(user_id);

-- ---------------------------------------------------------------------------
-- invoices
-- ---------------------------------------------------------------------------
create table if not exists invoices (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  client_id   uuid not null references clients(id) on delete cascade,
  invoice_no  text not null,
  amount      numeric(12,2) not null check (amount >= 0),
  currency    text not null default 'INR',
  issue_date  date not null,
  due_date    date not null,
  status      text not null default 'pending'
              check (status in ('pending','overdue','partial','paid','disputed')),
  paid_amount numeric(12,2) not null default 0 check (paid_amount >= 0),
  created_at  timestamptz not null default now(),
  unique (user_id, invoice_no)
);
create index if not exists idx_invoices_user   on invoices(user_id);
create index if not exists idx_invoices_client on invoices(client_id);
create index if not exists idx_invoices_status on invoices(status);
create index if not exists idx_invoices_due    on invoices(due_date);

-- ---------------------------------------------------------------------------
-- payments  (against an invoice)
-- ---------------------------------------------------------------------------
create table if not exists payments (
  id         uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoices(id) on delete cascade,
  amount     numeric(12,2) not null check (amount > 0),
  paid_on    date not null default current_date,
  method     text,
  reference  text,
  created_at timestamptz not null default now()
);
create index if not exists idx_payments_invoice on payments(invoice_id);

-- ---------------------------------------------------------------------------
-- communications  (follow-up messages per invoice)
-- ---------------------------------------------------------------------------
create table if not exists communications (
  id         uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoices(id) on delete cascade,
  direction  text not null check (direction in ('outbound','inbound')),
  channel    text not null default 'email',
  subject    text,
  body       text,
  status     text not null default 'draft'
             check (status in ('draft','pending_approval','sent')),
  created_at timestamptz not null default now()
);
create index if not exists idx_comms_invoice on communications(invoice_id);

-- ---------------------------------------------------------------------------
-- agent_logs  (audit trail of every agent decision)
-- ---------------------------------------------------------------------------
create table if not exists agent_logs (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users(id) on delete cascade,
  agent         text not null,
  invoice_id    uuid references invoices(id) on delete set null,
  input_summary text,
  output_json   jsonb,
  reasoning     text,
  created_at    timestamptz not null default now()
);
create index if not exists idx_agent_logs_user    on agent_logs(user_id);
create index if not exists idx_agent_logs_invoice on agent_logs(invoice_id);

-- ---------------------------------------------------------------------------
-- approvals  (human-in-the-loop queue)
-- ---------------------------------------------------------------------------
create table if not exists approvals (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references users(id) on delete cascade,
  invoice_id       uuid references invoices(id) on delete cascade,
  communication_id uuid references communications(id) on delete set null,
  reason           text,
  recommendation   text,
  status           text not null default 'pending'
                   check (status in ('pending','approved','rejected')),
  decided_at       timestamptz,
  created_at       timestamptz not null default now()
);
create index if not exists idx_approvals_user   on approvals(user_id);
create index if not exists idx_approvals_status on approvals(status);

-- ---------------------------------------------------------------------------
-- policies  (one row per user — the owner's guardrails)
-- ---------------------------------------------------------------------------
create table if not exists policies (
  id                        uuid primary key default gen_random_uuid(),
  user_id                   uuid not null unique references users(id) on delete cascade,
  max_extension_days        integer not null default 14,
  max_discount_pct          numeric(5,2) not null default 10,
  min_partial_pct           numeric(5,2) not null default 25,
  approval_amount_threshold numeric(12,2) not null default 50000,
  dry_run                   boolean not null default true,
  created_at                timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- client_scores  (one row per client — payment behaviour)
-- ---------------------------------------------------------------------------
create table if not exists client_scores (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null unique references clients(id) on delete cascade,
  avg_days_late numeric(8,2) not null default 0,
  on_time_rate  numeric(5,2) not null default 0,
  risk_score    numeric(5,2) not null default 0,
  updated_at    timestamptz not null default now()
);
create index if not exists idx_client_scores_client on client_scores(client_id);
