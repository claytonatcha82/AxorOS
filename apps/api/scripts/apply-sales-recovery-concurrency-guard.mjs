import { Pool } from 'pg';

const connectionString = process.env.AXOROS_DATABASE_URL;
if (!connectionString) throw new Error('AXOROS_DATABASE_URL is required.');

const pool = new Pool({ connectionString, max: 1, application_name: 'axoros-sales-recovery-guard' });

const sql = `
create or replace function operational.guard_sales_context_recovery_attempt()
returns trigger
language plpgsql
as $$
declare
  lead_id text;
  source_assessment_id text;
  attempt_count integer;
  terminal_count integer;
  active_count integer;
begin
  if new.event_type <> 'sales_context_recovery_attempted' then
    return new;
  end if;

  lead_id := new.payload ->> 'leadId';
  source_assessment_id := new.payload ->> 'sourceAssessmentRecordId';

  if nullif(trim(lead_id), '') is null or nullif(trim(source_assessment_id), '') is null then
    return new;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('sales-context-recovery:' || lead_id || ':' || source_assessment_id, 0)
  );

  select count(*)::integer
    into attempt_count
    from operational.workflow_events
   where event_type = 'sales_context_recovery_attempted'
     and payload ->> 'leadId' = lead_id
     and payload ->> 'sourceAssessmentRecordId' = source_assessment_id;

  select count(*)::integer
    into terminal_count
    from operational.workflow_events
   where event_type in ('sales_context_recovery_completed', 'sales_context_recovery_failed')
     and payload ->> 'leadId' = lead_id
     and payload ->> 'sourceAssessmentRecordId' = source_assessment_id;

  -- An attempt is an active claim only while it is recent. This preserves the
  -- advisory-lock protection against concurrent workers while allowing a later
  -- recovery cycle to reclaim work after a process crash or interrupted run.
  select count(*)::integer
    into active_count
    from operational.workflow_events attempted
   where attempted.event_type = 'sales_context_recovery_attempted'
     and attempted.payload ->> 'leadId' = lead_id
     and attempted.payload ->> 'sourceAssessmentRecordId' = source_assessment_id
     and attempted.created_at >= now() - interval '30 minutes'
     and not exists (
       select 1
         from operational.workflow_events terminal
        where terminal.event_type in ('sales_context_recovery_completed', 'sales_context_recovery_failed')
          and terminal.payload ->> 'leadId' = lead_id
          and terminal.payload ->> 'sourceAssessmentRecordId' = source_assessment_id
          and terminal.created_at >= attempted.created_at
     );

  if active_count > 0 then
    raise exception using
      errcode = '55P03',
      message = 'sales_context_recovery_already_claimed',
      detail = format('leadId=%s sourceAssessmentRecordId=%s', lead_id, source_assessment_id);
  end if;

  if attempt_count >= 3 then
    raise exception using
      errcode = 'P0001',
      message = 'sales_context_recovery_max_attempts_reached',
      detail = format('leadId=%s sourceAssessmentRecordId=%s attempts=%s', lead_id, source_assessment_id, attempt_count);
  end if;

  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1
      from pg_trigger
     where tgname = 'sales_context_recovery_attempt_guard'
       and tgrelid = 'operational.workflow_events'::regclass
  ) then
    create trigger sales_context_recovery_attempt_guard
      before insert on operational.workflow_events
      for each row
      execute function operational.guard_sales_context_recovery_attempt();
  end if;
end;
$$;
`;

try {
  await pool.query(sql);
  console.log(JSON.stringify({ level: 'info', event: 'sales_recovery_concurrency_guard_ready', trigger: 'sales_context_recovery_attempt_guard' }));
} finally {
  await pool.end();
}
