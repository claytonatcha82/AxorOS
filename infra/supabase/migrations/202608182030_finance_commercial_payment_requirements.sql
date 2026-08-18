create schema if not exists finance;

create table if not exists finance.commercial_payment_requirements (
  commercial_record_reference text not null,
  gate text not null,
  requirement_reference text not null,
  requirement_type text not null,
  required_amount_minor bigint not null,
  currency text not null,
  status text not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (commercial_record_reference, gate),
  unique (requirement_reference),
  constraint commercial_payment_requirements_gate_check
    check (gate in ('PRODUCTION_START', 'MILESTONE_RELEASE', 'FINAL_HANDOVER')),
  constraint commercial_payment_requirements_type_check
    check (requirement_type in ('DEPOSIT', 'MILESTONE', 'FINAL', 'APPROVED_ALTERNATIVE')),
  constraint commercial_payment_requirements_amount_check
    check (required_amount_minor > 0),
  constraint commercial_payment_requirements_currency_check
    check (currency ~ '^[A-Z]{3}$'),
  constraint commercial_payment_requirements_status_check
    check (status in ('ACTIVE', 'SATISFIED', 'SUPERSEDED', 'CANCELLED'))
);

create index if not exists idx_commercial_payment_requirements_status
  on finance.commercial_payment_requirements (status);
