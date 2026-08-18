create schema if not exists finance;

create table if not exists finance.commercial_payment_satisfactions (
  requirement_reference text primary key,
  clearance_id text not null,
  commercial_record_reference text not null,
  gate text not null,
  satisfied_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (clearance_id, requirement_reference),
  constraint commercial_payment_satisfactions_requirement_fk
    foreign key (requirement_reference)
    references finance.commercial_payment_requirements(requirement_reference),
  constraint commercial_payment_satisfactions_clearance_fk
    foreign key (clearance_id)
    references finance.clearance_decisions(clearance_id),
  constraint commercial_payment_satisfactions_gate_check
    check (gate in ('PRODUCTION_START', 'MILESTONE_RELEASE', 'FINAL_HANDOVER'))
);

create index if not exists idx_commercial_payment_satisfactions_clearance
  on finance.commercial_payment_satisfactions (clearance_id);
