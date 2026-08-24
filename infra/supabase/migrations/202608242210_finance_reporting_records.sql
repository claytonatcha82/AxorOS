create schema if not exists finance;

create table if not exists finance.expenses (
  expense_id text primary key,
  category text not null check (category in (
    'DIRECT_PROJECT_COST','VARIABLE_OPERATING_COST','FIXED_OPERATING_COST','FOUNDER_EXPENSE',
    'REFUND','PAYMENT_PROCESSING_FEE','SOFTWARE','HOSTING','DOMAIN','AI','MARKETING',
    'ADMINISTRATION','PROFESSIONAL_SERVICES','OTHER'
  )),
  vendor text not null check (length(trim(vendor)) > 0),
  description text not null check (length(trim(description)) > 0),
  amount_minor bigint not null check (amount_minor >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  billing_type text not null check (billing_type in ('ONE_TIME','RECURRING')),
  billing_period text check (billing_period is null or billing_period in ('MONTHLY','QUARTERLY','ANNUAL')),
  client_id uuid references operational.clients(id) on delete set null,
  project_id uuid references operational.projects(id) on delete set null,
  expense_date date not null,
  receipt_reference text,
  status text not null check (status in ('PLANNED','INCURRED','PAID','CANCELLED')),
  approved_by text not null check (length(trim(approved_by)) > 0),
  evidence_references jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence_references) = 'array'),
  created_at timestamptz not null default now(),
  check (
    (billing_type = 'ONE_TIME' and billing_period is null)
    or (billing_type = 'RECURRING' and billing_period is not null)
  )
);

create index if not exists finance_expenses_status_date_idx
  on finance.expenses (status, expense_date desc);
create index if not exists finance_expenses_project_idx
  on finance.expenses (project_id) where project_id is not null;

create table if not exists finance.subscriptions (
  subscription_id text primary key,
  client_id uuid not null references operational.clients(id) on delete restrict,
  service text not null check (length(trim(service)) > 0),
  billing_frequency text not null check (billing_frequency in ('MONTHLY','QUARTERLY','ANNUAL')),
  amount_minor bigint not null check (amount_minor >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  start_date date not null,
  next_billing_date date not null,
  status text not null check (status in ('TRIAL','ACTIVE','PAST_DUE','SUSPENDED','CANCELLED','EXPIRED')),
  auto_renew boolean not null default false,
  payment_method_reference text,
  invoice_policy text not null check (length(trim(invoice_policy)) > 0),
  cancellation_date date,
  commercial_reference text not null check (length(trim(commercial_reference)) > 0),
  evidence_references jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence_references) = 'array'),
  approved_by text not null check (length(trim(approved_by)) > 0),
  created_at timestamptz not null default now(),
  check (cancellation_date is null or cancellation_date >= start_date)
);

create index if not exists finance_subscriptions_status_billing_idx
  on finance.subscriptions (status, next_billing_date);
create index if not exists finance_subscriptions_client_idx
  on finance.subscriptions (client_id);
