create extension if not exists pgcrypto;

create table if not exists knowledge.ingestion_runs (
  id uuid primary key default gen_random_uuid(),
  source_commit text not null,
  knowledge_release text not null,
  index_version text not null,
  chunking_version text not null,
  metadata_schema_version text not null,
  status text not null default 'running' check (status in ('running','succeeded','failed','cancelled')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  document_count integer not null default 0 check (document_count >= 0),
  chunk_count integer not null default 0 check (chunk_count >= 0),
  error_summary text
);

create table if not exists knowledge.documents (
  id uuid primary key default gen_random_uuid(),
  document_id text not null unique,
  title text not null,
  path text not null unique,
  volume text,
  folder text,
  document_type text not null,
  knowledge_domain text not null,
  status text not null default 'active' check (status in ('active','draft','deprecated','archived','superseded')),
  priority smallint not null default 50 check (priority between 0 and 100),
  authority_level text not null default 'reference' check (authority_level in ('critical_policy','authoritative','recommended','reference','example','historical')),
  allowed_agents text[] not null default '{}',
  applicable_tasks text[] not null default '{}',
  service_types text[] not null default '{}',
  technology text[] not null default '{}',
  project_stage text[] not null default '{}',
  security_classification text not null default 'internal' check (security_classification in ('public','internal','restricted','confidential')),
  retrieval_weight numeric(6,3) not null default 1.000 check (retrieval_weight > 0),
  source_version text not null,
  checksum text not null,
  last_modified timestamptz not null,
  ingestion_run_id uuid references knowledge.ingestion_runs(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists knowledge.chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references knowledge.documents(id) on delete cascade,
  chunk_index integer not null check (chunk_index >= 0),
  heading_path text[] not null default '{}',
  chunk_type text not null,
  content text not null,
  content_tsv tsvector generated always as (to_tsvector('english', coalesce(content, ''))) stored,
  previous_chunk_id uuid references knowledge.chunks(id) on delete set null,
  next_chunk_id uuid references knowledge.chunks(id) on delete set null,
  group_id text,
  checksum text not null,
  token_estimate integer check (token_estimate is null or token_estimate >= 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(document_id, chunk_index),
  unique(document_id, checksum)
);

create index if not exists knowledge_documents_domain_idx on knowledge.documents (knowledge_domain);
create index if not exists knowledge_documents_status_idx on knowledge.documents (status);
create index if not exists knowledge_documents_authority_idx on knowledge.documents (authority_level);
create index if not exists knowledge_documents_allowed_agents_gin on knowledge.documents using gin (allowed_agents);
create index if not exists knowledge_documents_applicable_tasks_gin on knowledge.documents using gin (applicable_tasks);
create index if not exists knowledge_chunks_document_idx on knowledge.chunks (document_id, chunk_index);
create index if not exists knowledge_chunks_tsv_gin on knowledge.chunks using gin (content_tsv);

create or replace function knowledge.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists knowledge_documents_set_updated_at on knowledge.documents;
create trigger knowledge_documents_set_updated_at
before update on knowledge.documents
for each row execute function knowledge.set_updated_at();

drop trigger if exists knowledge_chunks_set_updated_at on knowledge.chunks;
create trigger knowledge_chunks_set_updated_at
before update on knowledge.chunks
for each row execute function knowledge.set_updated_at();

revoke all on schema knowledge from public;
revoke all on all tables in schema knowledge from public;

comment on schema knowledge is 'Derived Atlas OS knowledge index. Atlas OS Markdown remains the authoritative source.';
comment on table knowledge.documents is 'Derived Atlas OS document metadata; reconstructable from source Markdown.';
comment on table knowledge.chunks is 'Structure-aware derived chunks for retrieval. No embeddings are stored in this migration.';
comment on table knowledge.ingestion_runs is 'Versioned ingestion provenance for reproducible knowledge releases.';
