create table if not exists operations.production_delivery_readiness_decisions (
  readiness_id text primary key,
  commercial_record_reference text not null,
  state text not null check (state in ('DELIVERY_READY', 'DELIVERY_BLOCKED')),
  internal_qa_passed boolean not null default false,
  client_approved boolean not null default false,
  payment_condition_satisfied boolean not null default false,
  rollback_prepared boolean not null default false,
  seo_checked boolean not null default false,
  security_checked boolean not null default false,
  deployment_approved boolean not null default false,
  evidence_references jsonb not null default '[]'::jsonb,
  approved_by text not null,
  approved_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint production_delivery_readiness_evidence_array check (jsonb_typeof(evidence_references) = 'array'),
  constraint production_delivery_ready_requires_all_gates check (
    state <> 'DELIVERY_READY' or (
      internal_qa_passed and client_approved and payment_condition_satisfied and rollback_prepared
      and seo_checked and security_checked and deployment_approved
    )
  )
);

create index if not exists production_delivery_readiness_commercial_record_idx
  on operations.production_delivery_readiness_decisions (commercial_record_reference, approved_at desc);
