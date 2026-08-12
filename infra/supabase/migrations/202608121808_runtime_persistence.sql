create schema if not exists runtime;

create table if not exists runtime.agent_executions (
  execution_id text primary key,
  task_id text not null,
  correlation_id text not null,
  destination_agent text not null,
  status text not null,
  version integer not null check (version >= 1),
  task jsonb not null,
  result jsonb,
  last_event_id text,
  persisted_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists agent_executions_task_id_idx on runtime.agent_executions (task_id);
create index if not exists agent_executions_correlation_id_idx on runtime.agent_executions (correlation_id);
create index if not exists agent_executions_destination_status_idx on runtime.agent_executions (destination_agent, status);

create table if not exists runtime.agent_events (
  event_id text primary key,
  execution_id text not null references runtime.agent_executions(execution_id) on delete cascade,
  task_id text not null,
  correlation_id text not null,
  event_type text not null,
  actor text not null,
  from_status text,
  to_status text,
  payload jsonb not null default '{}'::jsonb,
  idempotency_key text not null unique,
  occurred_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists agent_events_execution_occurred_idx on runtime.agent_events (execution_id, occurred_at, event_id);
create index if not exists agent_events_correlation_idx on runtime.agent_events (correlation_id);

create table if not exists runtime.idempotency_records (
  idempotency_key text primary key,
  execution_id text not null,
  event_id text not null,
  operation text not null,
  first_seen_at timestamptz not null,
  completed boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists runtime_idempotency_execution_idx on runtime.idempotency_records (execution_id);
