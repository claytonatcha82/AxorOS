create schema if not exists finance;

create table if not exists finance.ledger_entries (
  entry_id text primary key,
  entry_type text not null,
  commercial_record_reference text not null,
  authority_type text not null,
  authority_reference text not null,
  evidence_references jsonb not null,
  amount_minor bigint,
  currency text,
  occurred_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  constraint finance_ledger_amount_check check (amount_minor is null or amount_minor >= 0),
  constraint finance_ledger_currency_check check (currency is null or currency ~ '^[A-Z]{3}$'),
  constraint finance_ledger_amount_currency_pair_check check ((amount_minor is null) = (currency is null)),
  constraint finance_ledger_evidence_array_check check (jsonb_typeof(evidence_references) = 'array' and jsonb_array_length(evidence_references) > 0),
  constraint finance_ledger_authority_unique unique (entry_type, authority_type, authority_reference)
);

create index if not exists idx_finance_ledger_commercial_record
  on finance.ledger_entries (commercial_record_reference, occurred_at);

create index if not exists idx_finance_ledger_authority
  on finance.ledger_entries (authority_type, authority_reference);
