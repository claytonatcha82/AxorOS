create schema if not exists operational;

create table if not exists operational.sales_inbound_reply_classifications (
  id bigint generated always as identity primary key,
  inbound_evidence_id text not null,
  outbound_record_id text not null,
  lead_id text not null,
  provider_message_id text not null,
  primary_category text not null,
  confidence double precision,
  evidence_reasons jsonb not null,
  opt_out_detected boolean not null,
  automated_response_detected boolean not null,
  delivery_failure_detected boolean not null,
  commercial_topic_detected boolean not null,
  sensitive_topic_detected boolean not null,
  uncertainty_detected boolean not null,
  classification_source text not null,
  model_reference text,
  response_authorised boolean not null default false,
  pricing_authorised boolean not null default false,
  discount_authorised boolean not null default false,
  commercial_commitment_authorised boolean not null default false,
  contract_authorised boolean not null default false,
  next_action text not null,
  human_review_required boolean not null,
  classified_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  constraint sales_inbound_reply_classifications_inbound_evidence_unique unique (inbound_evidence_id),
  constraint sales_inbound_reply_classifications_provider_message_unique unique (provider_message_id),
  constraint sales_inbound_reply_classifications_authority_false check (
    response_authorised = false and
    pricing_authorised = false and
    discount_authorised = false and
    commercial_commitment_authorised = false and
    contract_authorised = false
  )
);

create index if not exists sales_inbound_reply_classifications_lead_idx
  on operational.sales_inbound_reply_classifications (lead_id, classified_at desc);

create index if not exists sales_inbound_reply_classifications_outbound_idx
  on operational.sales_inbound_reply_classifications (outbound_record_id, classified_at desc);
