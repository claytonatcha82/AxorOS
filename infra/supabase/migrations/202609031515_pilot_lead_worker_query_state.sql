begin;

create table if not exists pilot_lead_worker_query_state (
  id serial primary key,
  state_key text not null default 'default',
  query_state jsonb not null default '{}',
  updated_at timestamptz not null default now(),
  unique(state_key)
);

commit;
