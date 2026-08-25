create schema if not exists production;

create table if not exists production.deployment_authorities (
  authority_id text primary key,
  commercial_record_reference text not null,
  project_name text not null,
  code_qa_passed boolean not null,
  functional_qa_passed boolean not null,
  visual_qa_passed boolean not null,
  business_qa_passed boolean not null,
  client_approved boolean not null,
  required_final_payment_condition_met boolean not null,
  rollback_prepared boolean not null,
  seo_checked boolean not null,
  security_checked boolean not null,
  deployment_approved boolean not null,
  evidence_references jsonb not null,
  approved_by text not null,
  approved_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint production_deployment_authority_evidence_array
    check (jsonb_typeof(evidence_references) = 'array')
);

create index if not exists production_deployment_authority_commercial_record_idx
  on production.deployment_authorities (commercial_record_reference, approved_at desc);

create index if not exists production_deployment_authority_project_idx
  on production.deployment_authorities (project_name, approved_at desc);
