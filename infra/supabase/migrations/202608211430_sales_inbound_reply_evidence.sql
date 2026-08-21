create schema if not exists operational;

create table if not exists operational.sales_inbound_reply_evidence (
  id bigint generated always as identity primary key,
  outbound_record_id text not null,
  lead_id text not null,
  provider_thread_reference text not null,
  provider_message_id text not null unique,
  sender_address text,
  recipient_address text,
  subject text,
  provider_internal_date text,
  snippet text,
  text_body text,
  recorded_at timestamptz not null default now(),
  constraint sales_inbound_reply_evidence_outbound_message_unique
    unique (outbound_record_id, provider_message_id)
);

create index if not exists sales_inbound_reply_evidence_lead_idx
  on operational.sales_inbound_reply_evidence (lead_id, recorded_at desc);

create index if not exists sales_inbound_reply_evidence_thread_idx
  on operational.sales_inbound_reply_evidence (provider_thread_reference, recorded_at asc);
