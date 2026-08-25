create schema if not exists runtime;

create table if not exists runtime.pilot_system_state (
  singleton_key text primary key check (singleton_key = 'axoros'),
  state text not null check (state in ('PILOT_DISABLED', 'PILOT_ACTIVE')),
  changed_by text not null,
  reason text not null,
  version integer not null check (version >= 1),
  changed_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into runtime.pilot_system_state (
  singleton_key,
  state,
  changed_by,
  reason,
  version,
  changed_at
) values (
  'axoros',
  'PILOT_DISABLED',
  'system',
  'Fail-closed initial state. Pilot activation requires an explicit Human Executive action.',
  1,
  now()
)
on conflict (singleton_key) do nothing;
