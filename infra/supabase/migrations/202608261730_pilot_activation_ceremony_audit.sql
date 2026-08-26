create schema if not exists runtime;

create table if not exists runtime.pilot_activation_ceremony_audit (
  audit_id text primary key,
  readiness_id text not null,
  action text not null check (action in ('PREVIEWED','ACTIVATION_APPROVED','DEACTIVATION_PROVED')),
  actor text not null check (actor = 'human_executive'),
  reason text not null,
  evidence_references jsonb not null,
  recorded_at timestamptz not null
);

create index if not exists pilot_activation_ceremony_audit_readiness_idx
  on runtime.pilot_activation_ceremony_audit (readiness_id, recorded_at desc);
