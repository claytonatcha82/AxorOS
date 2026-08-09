import pg from 'pg';

const { Client } = pg;
const connectionString = process.env.AXOROS_DATABASE_URL;

if (!connectionString) {
  console.error('FAIL  AXOROS_DATABASE_URL is not set.');
  process.exit(1);
}

const client = new Client({ connectionString, application_name: 'axoros-db-verifier' });

const failures = [];
const passes = [];

function pass(message) {
  passes.push(message);
  console.log(`PASS  ${message}`);
}

function fail(message) {
  failures.push(message);
  console.error(`FAIL  ${message}`);
}

try {
  await client.connect();
  pass('PostgreSQL connection');

  const schemaResult = await client.query(`
    select schema_name
    from information_schema.schemata
    where schema_name in ('operational', 'knowledge')
    order by schema_name
  `);
  const schemas = new Set(schemaResult.rows.map((row) => row.schema_name));
  for (const schema of ['operational', 'knowledge']) {
    schemas.has(schema) ? pass(`Schema ${schema}`) : fail(`Schema ${schema} missing`);
  }

  const tableResult = await client.query(`
    select table_name
    from information_schema.tables
    where table_schema = 'operational'
      and table_name in ('clients', 'leads', 'projects', 'workflow_events')
    order by table_name
  `);
  const tables = new Set(tableResult.rows.map((row) => row.table_name));
  for (const table of ['clients', 'leads', 'projects', 'workflow_events']) {
    tables.has(table) ? pass(`Table operational.${table}`) : fail(`Table operational.${table} missing`);
  }

  const roleResult = await client.query(`
    select rolname, rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolbypassrls
    from pg_roles
    where rolname = 'axoros_api'
  `);

  if (roleResult.rowCount === 1) {
    const role = roleResult.rows[0];
    pass('Role axoros_api exists');
    role.rolcanlogin === false ? pass('Role axoros_api is NOLOGIN') : fail('Role axoros_api unexpectedly has LOGIN');
    role.rolsuper === false ? pass('Role axoros_api is not superuser') : fail('Role axoros_api is superuser');
    role.rolcreatedb === false ? pass('Role axoros_api cannot create databases') : fail('Role axoros_api can create databases');
    role.rolcreaterole === false ? pass('Role axoros_api cannot create roles') : fail('Role axoros_api can create roles');
    role.rolbypassrls === false ? pass('Role axoros_api cannot bypass RLS') : fail('Role axoros_api can bypass RLS');
  } else {
    fail('Role axoros_api missing');
  }

  const privilegesResult = await client.query(`
    select
      has_schema_privilege('axoros_api', 'operational', 'USAGE') as operational_usage,
      has_schema_privilege('axoros_api', 'knowledge', 'USAGE') as knowledge_usage,
      has_table_privilege('axoros_api', 'operational.clients', 'SELECT') as clients_select,
      has_table_privilege('axoros_api', 'operational.clients', 'DELETE') as clients_delete,
      has_table_privilege('axoros_api', 'operational.leads', 'SELECT,INSERT,UPDATE') as leads_rw,
      has_table_privilege('axoros_api', 'operational.leads', 'DELETE') as leads_delete,
      has_table_privilege('axoros_api', 'operational.projects', 'SELECT,INSERT,UPDATE') as projects_rw,
      has_table_privilege('axoros_api', 'operational.projects', 'DELETE') as projects_delete,
      has_table_privilege('axoros_api', 'operational.workflow_events', 'SELECT,INSERT') as events_append,
      has_table_privilege('axoros_api', 'operational.workflow_events', 'UPDATE,DELETE') as events_mutate
  `);
  const p = privilegesResult.rows[0];
  p.operational_usage ? pass('axoros_api can use operational schema') : fail('axoros_api lacks operational schema usage');
  !p.knowledge_usage ? pass('axoros_api cannot use knowledge schema') : fail('axoros_api unexpectedly has knowledge schema access');
  p.clients_select ? pass('axoros_api can read clients') : fail('axoros_api cannot read clients');
  !p.clients_delete ? pass('axoros_api cannot delete clients') : fail('axoros_api can delete clients');
  p.leads_rw ? pass('axoros_api can read/write leads') : fail('axoros_api lacks lead permissions');
  !p.leads_delete ? pass('axoros_api cannot delete leads') : fail('axoros_api can delete leads');
  p.projects_rw ? pass('axoros_api can read/write projects') : fail('axoros_api lacks project permissions');
  !p.projects_delete ? pass('axoros_api cannot delete projects') : fail('axoros_api can delete projects');
  p.events_append ? pass('axoros_api can read/append workflow events') : fail('axoros_api lacks workflow event permissions');
  !p.events_mutate ? pass('axoros_api cannot mutate/delete workflow events') : fail('axoros_api can mutate/delete workflow events');
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
} finally {
  await client.end().catch(() => undefined);
}

if (failures.length > 0) {
  console.error(`\nDatabase verification failed: ${failures.length} check(s) failed.`);
  process.exit(1);
}

console.log(`\nDatabase verification passed: ${passes.length} checks.`);
