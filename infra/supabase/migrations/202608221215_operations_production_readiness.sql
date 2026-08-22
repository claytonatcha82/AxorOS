create schema if not exists operations;

create table if not exists operations.production_readiness_decisions (
  readiness_id text primary key,
  commercial_record_reference text not null,
  state text not null,
  contract_signed boolean not null,
  onboarding_complete boolean not null,
  assets_available boolean not null,
  planning_complete boolean not null,
  evidence_references jsonb not null,
  approved_by text not null,
  approved_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint operations_production_readiness_state_check
    check (state in ('OPERATIONS_READY', 'OPERATIONS_BLOCKED')),
  constraint operations_production_readiness_evidence_array
    check (jsonb_typeof(evidence_references) = 'array')
);

create index if not exists operations_production_readiness_commercial_record_idx
  on operations.production_readiness_decisions (commercial_record_reference, approved_at desc);
