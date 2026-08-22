create schema if not exists operational;

create table if not exists operational.sales_email_send_attempts (
  id bigint generated always as identity primary key,
  send_gate_record_id text not null unique,
  draft_record_id text not null,
  lead_id text not null,
  idempotency_key text not null unique,
  status text not null default 'reserved',
  provider_message_id text,
  error_message text,
  reserved_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint sales_email_send_attempts_status_check check (status in ('reserved', 'sent', 'failed')),
  constraint sales_email_send_attempts_sent_requires_provider_message check (
    status <> 'sent' or (provider_message_id is not null and btrim(provider_message_id) <> '')
  ),
  constraint sales_email_send_attempts_failed_requires_error check (
    status <> 'failed' or (error_message is not null and btrim(error_message) <> '')
  )
);

create index if not exists sales_email_send_attempts_lead_idx
  on operational.sales_email_send_attempts (lead_id, reserved_at desc);

create index if not exists sales_email_send_attempts_status_idx
  on operational.sales_email_send_attempts (status, reserved_at asc);
