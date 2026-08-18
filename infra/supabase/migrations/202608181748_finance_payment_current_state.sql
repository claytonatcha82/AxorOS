create schema if not exists finance;

create table if not exists finance.payment_current_state (
  provider text not null,
  provider_payment_reference text not null,
  commercial_record_reference text not null,
  payment_status text not null,
  authority_state text not null,
  reason text not null,
  latest_event_type text not null,
  latest_provider_event_reference text not null,
  latest_evidence_reference text not null,
  latest_occurred_at timestamptz not null,
  amount_minor bigint,
  currency text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (provider, provider_payment_reference),
  constraint finance_payment_current_status_check check (
    payment_status in ('CREATED', 'PENDING', 'PROCESSING', 'CONFIRMED', 'SETTLED', 'FAILED', 'CANCELLED', 'EXPIRED', 'REFUNDED', 'PARTIALLY_REFUNDED', 'CHARGEBACK', 'DISPUTED')
  ),
  constraint finance_payment_current_authority_check check (authority_state in ('AUTHORIZED', 'BLOCKED', 'MANUAL_REVIEW')),
  constraint finance_payment_current_event_type_check check (
    latest_event_type in ('payment_paid', 'payment_pending', 'payment_failed', 'payment_refunded', 'payment_reversed', 'payment_disputed', 'payment_chargeback', 'unknown')
  ),
  constraint finance_payment_current_amount_positive check (amount_minor is null or amount_minor > 0),
  constraint finance_payment_current_currency_format check (currency is null or currency ~ '^[A-Z]{3}$')
);

create index if not exists finance_payment_current_commercial_record_idx
  on finance.payment_current_state (commercial_record_reference, updated_at desc);

create index if not exists finance_payment_current_authority_idx
  on finance.payment_current_state (authority_state, updated_at desc);
