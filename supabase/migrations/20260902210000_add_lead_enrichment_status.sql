begin;

alter table operational.leads
  add column if not exists enrichment_status text;

update operational.leads
set enrichment_status = case
  when exists (
    select 1
    from jsonb_array_elements(coalesce(evidence, '[]'::jsonb)) item
    where item->>'kind' = 'public_web_enrichment'
      and item->>'websiteVerificationStatus' = 'verified'
  ) then 'verified'
  when exists (
    select 1
    from jsonb_array_elements(coalesce(evidence, '[]'::jsonb)) item
    where item->>'kind' = 'public_web_enrichment'
      and item->>'websiteVerificationStatus' = 'not_found'
  ) then 'not_found'
  else 'pending'
end
where enrichment_status is null;

alter table operational.leads
  alter column enrichment_status set default 'pending',
  alter column enrichment_status set not null;

alter table operational.leads
  drop constraint if exists leads_enrichment_status_check;

alter table operational.leads
  add constraint leads_enrichment_status_check
  check (enrichment_status in ('pending','verified','not_found','ambiguous','not_applicable'));

create index if not exists leads_enrichment_status_idx
  on operational.leads(enrichment_status);

comment on column operational.leads.enrichment_status is
  'Authoritative public-web enrichment state. Retry eligibility is pending only; requeue is explicit and auditable.';

commit;
