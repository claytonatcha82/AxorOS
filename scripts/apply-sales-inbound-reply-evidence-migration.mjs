import fs from 'node:fs/promises';
import pg from 'pg';

const { Client } = pg;
const connectionString = process.env.AXOROS_DATABASE_URL;
const migrationPaths = [
  new URL('../infra/supabase/migrations/202608211430_sales_inbound_reply_evidence.sql', import.meta.url),
  new URL('../infra/supabase/migrations/202608212350_sales_inbound_reply_delivery_status_provenance.sql', import.meta.url),
];

if (!connectionString) {
  console.error('FAIL  AXOROS_DATABASE_URL is not set.');
  process.exit(1);
}

const migrations = await Promise.all(migrationPaths.map((migrationPath) => fs.readFile(migrationPath, 'utf8')));
const client = new Client({ connectionString, application_name: 'axoros-sales-inbound-reply-evidence-migration' });

try {
  await client.connect();
  await client.query('begin');
  for (const sql of migrations) await client.query(sql);
  await client.query('commit');
  console.log('PASS  Sales inbound reply evidence migrations applied.');
} catch (error) {
  await client.query('rollback').catch(() => undefined);
  console.error(`FAIL  ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}
