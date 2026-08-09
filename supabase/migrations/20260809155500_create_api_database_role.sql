begin;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'axoros_api') then
    create role axoros_api nologin;
  end if;
end
$$;

grant usage on schema operational to axoros_api;
revoke all on schema knowledge from axoros_api;

revoke all on all tables in schema operational from axoros_api;
grant select on operational.clients to axoros_api;
grant select, insert, update on operational.leads to axoros_api;
grant select, insert, update on operational.projects to axoros_api;
grant select, insert on operational.workflow_events to axoros_api;

revoke all on all sequences in schema operational from axoros_api;

alter default privileges in schema operational revoke all on tables from axoros_api;

comment on role axoros_api is 'Least-privilege AxorOS API database role. NOLOGIN; runtime login credentials are provisioned separately through secret-managed infrastructure.';

commit;
