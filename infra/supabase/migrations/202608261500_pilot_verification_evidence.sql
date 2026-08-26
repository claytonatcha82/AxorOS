create schema if not exists runtime;

create table if not exists runtime.pilot_verification_evidence (
  evidence_id text primary key,
  category text not null check (category in (
    'SYNTHETIC_LIFECYCLE',
    'PERSISTED_RUNTIME',
    'FINANCE_INTEGRITY',
    'CONTROL_PLANE',
    'DEPLOYMENT_SAFETY'
  )),
  outcome text not null check (outcome in ('PASS', 'FAIL')),
  verifier text not null,
  source_reference text not null,
  details jsonb not null default '{}'::jsonb,
  verified_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_pilot_verification_evidence_category_verified_at
  on runtime.pilot_verification_evidence (category, verified_at desc);
