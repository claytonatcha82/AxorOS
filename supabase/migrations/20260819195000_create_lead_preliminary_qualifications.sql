begin;

create table operational.lead_preliminary_qualifications (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references operational.leads(id) on delete cascade,
  total_score integer check (total_score is null or total_score between 0 and 60),
  suggested_status text not null check (suggested_status in ('excellent','good','moderate','poor_fit','insufficient_information')),
  human_review_required boolean not null default true check (human_review_required = true),
  assessments jsonb not null,
  missing_information jsonb not null default '[]'::jsonb,
  atlas_source_paths jsonb not null default '[]'::jsonb,
  actor_id text not null default 'lead_agent',
  created_at timestamptz not null default now()
);

create index lead_preliminary_qualifications_lead_created_at_idx
  on operational.lead_preliminary_qualifications (lead_id, created_at desc);

comment on table operational.lead_preliminary_qualifications is
  'Append-only Lead Agent preliminary qualification recommendations. These records are evidence for human review and never represent final qualification authority.';

commit;
