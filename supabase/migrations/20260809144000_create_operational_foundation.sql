begin;

create schema if not exists operational;
create schema if not exists knowledge;

create table operational.clients (
  id uuid primary key default gen_random_uuid(),
  display_name text not null check (length(trim(display_name)) > 0),
  legal_name text,
  status text not null default 'prospect' check (status in ('prospect','active','inactive','archived')),
  primary_email text,
  primary_phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table operational.leads (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references operational.clients(id) on delete set null,
  company_name text not null check (length(trim(company_name)) > 0),
  contact_name text,
  contact_email text,
  source text,
  opportunity_summary text,
  lead_score integer check (lead_score is null or lead_score between 0 and 100),
  status text not null default 'new' check (status in ('new','qualified','disqualified','engaged','converted')),
  evidence jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table operational.projects (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references operational.clients(id) on delete restrict,
  lead_id uuid references operational.leads(id) on delete set null,
  name text not null check (length(trim(name)) > 0),
  status text not null default 'pending' check (status in ('pending','active','qa','awaiting_approval','delivered','cancelled','archived')),
  service_type text not null default 'website',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table operational.workflow_events (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references operational.clients(id) on delete set null,
  project_id uuid references operational.projects(id) on delete set null,
  event_type text not null check (length(trim(event_type)) > 0),
  actor_type text not null check (actor_type in ('founder','agent','system','client','provider')),
  actor_id text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index leads_status_idx on operational.leads(status);
create index leads_client_id_idx on operational.leads(client_id);
create index projects_client_id_idx on operational.projects(client_id);
create index projects_status_idx on operational.projects(status);
create index workflow_events_project_id_created_at_idx on operational.workflow_events(project_id, created_at desc);
create index workflow_events_client_id_created_at_idx on operational.workflow_events(client_id, created_at desc);

create or replace function operational.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger clients_set_updated_at
before update on operational.clients
for each row execute function operational.set_updated_at();

create trigger leads_set_updated_at
before update on operational.leads
for each row execute function operational.set_updated_at();

create trigger projects_set_updated_at
before update on operational.projects
for each row execute function operational.set_updated_at();

comment on schema operational is 'Persistent AxorOS business and workflow state.';
comment on schema knowledge is 'Reserved for derived Atlas OS knowledge infrastructure. Knowledge tables are introduced in the knowledge-service step.';

commit;
