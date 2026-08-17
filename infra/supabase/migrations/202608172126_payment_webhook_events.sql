create schema if not exists finance;

create table if not exists finance.payment_webhook_events (
  id bigint generated always as identity primary key,
  idempotency_key text not null unique,
  provider text not null,
  provider_event_reference text not null,
  provider_payment_reference text not null,
  event_type text not null,
  commercial_record_reference text not null,
  amount_minor bigint,
  currency text,
  occurred_at timestamptz not null,
  evidence_reference text not null,
  received_at timestamptz not null default now(),
  constraint payment_webhook_events_provider_event_unique unique (provider, provider_event_reference),
  constraint payment_webhook_events_amount_positive check (amount_minor is null or amount_minor > 0),
  constraint payment_webhook_events_currency_format check (currency is null or currency ~ '^[A-Z]{3}$')
);

create index if not exists payment_webhook_events_payment_reference_idx
  on finance.payment_webhook_events (provider, provider_payment_reference);

create index if not exists payment_webhook_events_commercial_record_idx
  on finance.payment_webhook_events (commercial_record_reference, occurred_at desc);
