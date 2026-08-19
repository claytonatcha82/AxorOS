begin;

create table if not exists operational.lead_source_identities (
  provider text not null,
  external_id text not null,
  lead_id uuid not null references operational.leads(id) on delete cascade,
  created_at timestamptz not null default now(),
  refreshed_at timestamptz not null default now(),
  primary key (provider, external_id)
);

create index if not exists lead_source_identities_lead_id_idx
  on operational.lead_source_identities (lead_id);

insert into operational.lead_source_identities (provider, external_id, lead_id)
select distinct on (evidence_item->>'providerPlaceId')
  'google_places',
  evidence_item->>'providerPlaceId',
  l.id
from operational.leads l
cross join lateral jsonb_array_elements(
  case when jsonb_typeof(l.evidence) = 'array' then l.evidence else '[]'::jsonb end
) as evidence_item
where l.source = 'google_places'
  and evidence_item->>'provider' = 'google_places'
  and nullif(btrim(evidence_item->>'providerPlaceId'), '') is not null
order by evidence_item->>'providerPlaceId', l.created_at asc, l.id asc
on conflict (provider, external_id) do nothing;

grant select, insert, update on operational.lead_source_identities to axoros_api;

comment on table operational.lead_source_identities is
  'Durable provider identities for operational leads. Unique provider/external_id prevents concurrent duplicate lead creation.';

commit;
