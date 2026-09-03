import pg from 'pg';

const { Client } = pg;
const connectionString = process.env.AXOROS_DATABASE_URL;
const [leadId, expectedStatus] = process.argv.slice(2);
const allowedStatuses = new Set(['verified', 'not_found', 'ambiguous', 'not_applicable']);

if (!connectionString) {
  console.error('FAIL  AXOROS_DATABASE_URL is not set.');
  process.exit(1);
}
if (!leadId || !expectedStatus || !allowedStatuses.has(expectedStatus)) {
  console.error('Usage: node scripts/requeue-lead-for-enrichment.mjs <lead-id> <current-status>');
  console.error('Current status must be one of: verified, not_found, ambiguous, not_applicable.');
  process.exit(1);
}

const client = new Client({ connectionString, application_name: 'axoros-lead-enrichment-requeue', connectionTimeoutMillis: 15000 });
try {
  await client.connect();
  await client.query('begin');

  const result = await client.query(`
    update operational.leads
    set enrichment_status = 'pending'
    where id = $1
      and enrichment_status = $2
    returning id, company_name, enrichment_status
  `, [leadId, expectedStatus]);

  if (result.rowCount !== 1) {
    await client.query('rollback');
    console.error(`FAIL  Lead ${leadId} was not requeued. Verify the lead exists and its current enrichment_status is exactly '${expectedStatus}'.`);
    process.exit(1);
  }

  await client.query(`
    insert into operational.workflow_events (event_type, actor_type, actor_id, payload)
    values ('lead_enrichment_requeued', 'founder', 'founder', $1::jsonb)
  `, [JSON.stringify({ leadId, previousEnrichmentStatus: expectedStatus, nextEnrichmentStatus: 'pending', reason: 'Explicit founder requeue for public-web enrichment' })]);

  await client.query('commit');
  console.log(`PASS  Lead ${leadId} (${result.rows[0].company_name}) requeued for enrichment: ${expectedStatus} -> pending.`);
} catch (error) {
  await client.query('rollback').catch(() => undefined);
  console.error(`FAIL  ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
} finally {
  await client.end().catch(() => undefined);
}
