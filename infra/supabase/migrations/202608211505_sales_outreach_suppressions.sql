create table if not exists operational.sales_outreach_suppressions (
  id bigint generated always as identity primary key,
  lead_id text not null,
  recipient_address text not null,
  reason text not null,
  source_inbound_evidence_id text not null,
  source_provider_message_id text not null,
  active boolean not null default true,
  suppressed_at timestamptz not null default now(),
  constraint sales_outreach_suppressions_reason_check
    check (reason in ('explicit_opt_out')),
  constraint sales_outreach_suppressions_source_message_unique
    unique (source_provider_message_id)
);

create unique index if not exists sales_outreach_suppressions_active_recipient_unique
  on operational.sales_outreach_suppressions (lower(recipient_address))
  where active = true;

create index if not exists sales_outreach_suppressions_lead_id_idx
  on operational.sales_outreach_suppressions (lead_id);
