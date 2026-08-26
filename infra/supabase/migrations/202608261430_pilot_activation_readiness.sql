create schema if not exists runtime;

create table if not exists runtime.pilot_activation_readiness (
  readiness_id text primary key,
  state text not null check (state in ('PILOT_ACTIVATION_READY', 'PILOT_ACTIVATION_BLOCKED')),
  synthetic_lifecycle_verified boolean not null,
  persisted_runtime_verified boolean not null,
  finance_integrity_verified boolean not null,
  control_plane_verified boolean not null,
  deployment_safety_verified boolean not null,
  evidence_references jsonb not null,
  assessed_by text not null,
  assessed_at timestamptz not null,
  created_at timestamptz not null default now()
);
