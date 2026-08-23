create schema if not exists finance;

create table if not exists finance.payment_requests (
  requirement_reference text primary key,
  commercial_record_reference text not null,
  provider text not null,
  provider_payment_reference text not null unique,
  authorization_url text not null,
  amount_minor bigint not null,
  currency text not null,
  evidence_references jsonb not null,
  created_at timestamptz not null default now(),
  constraint finance_payment_requests_amount_check check (amount_minor > 0),
  constraint finance_payment_requests_currency_check check (currency ~ '^[A-Z]{3}$')
);

create index if not exists idx_finance_payment_requests_commercial_record
  on finance.payment_requests (commercial_record_reference);
