import pg from 'pg';

const { Client } = pg;
const connectionString = process.env.AXOROS_DATABASE_URL;
if (!connectionString) {
  console.error('FAIL  AXOROS_DATABASE_URL is not set.');
  process.exit(1);
}

const client = new Client({ connectionString, application_name: 'axoros-lead-source-identities-verifier' });
try {
  await client.connect();
  const table = await client.query(`select to_regclass('operational.lead_source_identities') as name`);
  if (!table.rows[0]?.name) throw new Error('operational.lead_source_identities does not exist.');

  const duplicate = await client.query(`
    select provider, external_id, count(*)::int as count
    from operational.lead_source_identities
    group by provider, external_id
    having count(*) > 1
    limit 1
  `);
  if (duplicate.rowCount) throw new Error('Duplicate provider/external_id identities exist.');

  const orphan = await client.query(`
    select i.provider, i.external_id
    from operational.lead_source_identities i
    left join operational.leads l on l.id = i.lead_id
    where l.id is null
    limit 1
  `);
  if (orphan.rowCount) throw new Error('Orphaned lead source identity exists.');

  const primaryKey = await client.query(`
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'operational'
      and t.relname = 'lead_source_identities'
      and c.contype = 'p'
    limit 1
  `);
  if (!primaryKey.rowCount) throw new Error('Lead source identity primary key is missing.');

  const counts = await client.query(`select count(*)::int as identities from operational.lead_source_identities`);
  console.log('PASS  Lead source identity table exists');
  console.log('PASS  Provider/external_id uniqueness boundary exists');
  console.log('PASS  No duplicate or orphaned source identities detected');
  console.log(`Identities: ${counts.rows[0]?.identities ?? 0}`);
} catch (error) {
  console.error(`FAIL  ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}
