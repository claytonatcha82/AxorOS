create schema if not exists finance;

create table if not exists finance.clearance_decisions (
  clearance_id text primary key,
  commercial_record_reference text not null,
  provider_payment_reference text not null,
  state text not null,
  reason text not null,
  evidence_references jsonb not null,
  amount_minor bigint not null,
  currency text not null,
  verified_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint finance_clearance_state_check check (state in ('FINANCE_CLEARED', 'FINANCE_PENDING')),
  constraint finance_clearance_amount_positive check (amount_minor > 0),
  constraint finance_clearance_currency_format check (currency ~ '^[A-Z]{3}$'),
  constraint finance_clearance_evidence_array check (jsonb_typeof(evidence_references) = 'array')
);

create index if not exists finance_clearance_commercial_record_idx
  on finance.clearance_decisions (commercial_record_reference, created_at desc);

create index if not exists finance_clearance_provider_payment_idx
  on finance.clearance_decisions (provider_payment_reference, created_at desc);
