alter table operational.sales_inbound_reply_evidence
  add column if not exists provider_delivery_status_evidence boolean not null default false;
