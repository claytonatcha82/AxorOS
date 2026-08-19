import fs from 'node:fs/promises';
import pg from 'pg';

const { Client } = pg;
const connectionString = process.env.AXOROS_DATABASE_URL;
const migrationPath = new URL('../infra/supabase/migrations/202608191725_lead_source_identities.sql', import.meta.url);

if (!connectionString) {
  console.error('FAIL  AXOROS_DATABASE_URL is not set.');
  process.exit(1);
}

const sql = await fs.readFile(migrationPath, 'utf8');
const client = new Client({ connectionString, application_name: 'axoros-lead-source-identities-migration' });

try {
  await client.connect();
  await client.query(sql);
  console.log('PASS  Lead source identity migration applied.');
} catch (error) {
  console.error(`FAIL  ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}
