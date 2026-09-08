import pg from 'pg';

const { Pool } = pg;
const leadId = 'db26c0e0-29ef-4b19-b52e-d6c929d6cb51';
const company = 'Proman Construction Managers';

const pool = new Pool({ connectionString: process.env.AXOROS_DATABASE_URL });

try {
  const tables = await pool.query(`
    select table_schema, table_name
    from information_schema.tables
    where table_schema in ('operational', 'agent_runtime')
    order by table_schema, table_name
  `);

  const events = await pool.query(`
    select id, event_type, actor_type, actor_id, created_at, payload
    from operational.workflow_events
    where payload ->> 'leadId' = $1
    order by created_at asc
  `, [leadId]);

  const assessments = events.rows.filter((row) => row.event_type === 'sales_opportunity_assessment_recorded');
  const recoveryAttempts = events.rows.filter((row) => row.event_type === 'sales_context_recovery_attempted');
  const retrievals = events.rows.filter((row) => row.event_type === 'sales_missing_context_retrieval_recorded');
  const recoveryCompletions = events.rows.filter((row) => row.event_type === 'sales_context_recovery_completed');

  console.log(JSON.stringify({
    diagnostic: 'sales_recovery_database_state_v1',
    company,
    leadId,
    operationalTables: tables.rows,
    eventCount: events.rowCount,
    latestAssessment: assessments.at(-1) ?? null,
    recoveryAttempts,
    retrievals,
    recoveryCompletions,
    eventTypes: [...new Set(events.rows.map((row) => row.event_type))],
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({
    diagnostic: 'sales_recovery_database_state_v1',
    company,
    leadId,
    error: error instanceof Error ? error.message : String(error),
  }, null, 2));
  process.exitCode = 0;
} finally {
  await pool.end();
}
