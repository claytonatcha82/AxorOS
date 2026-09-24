begin;

create table operational.lead_research_evidence (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references operational.leads(id) on delete cascade,
  provider text not null check (length(trim(provider)) > 0),
  research_type text not null check (length(trim(research_type)) > 0),
  execution_id text not null check (length(trim(execution_id)) > 0),
  query text,
  title text not null check (length(trim(title)) > 0),
  url text not null check (length(trim(url)) > 0),
  content text not null check (length(trim(content)) > 0),
  score double precision,
  retrieved_at timestamptz not null default now(),
  unique (lead_id, provider, url)
);

create index lead_research_evidence_lead_retrieved_idx
  on operational.lead_research_evidence (lead_id, retrieved_at desc);

comment on table operational.lead_research_evidence is
  'Reusable public-web research evidence scoped to a lead. Provider-specific results are persisted as evidence and may be reused by Lead and Sales without re-running external research.';

commit;
