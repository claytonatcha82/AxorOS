import fs from 'node:fs/promises';
import pg from 'pg';

const { Client } = pg;
const connectionString = process.env.AXOROS_DATABASE_URL;
const migrationPath = new URL('../infra/supabase/migrations/202608201930_sales_email_send_attempts.sql', import.meta.url);

if (!connectionString) {
  console.error('FAIL  AXOROS_DATABASE_URL is not set.');
  process.exit(1);
}

const sql = await fs.readFile(migrationPath, 'utf8');
const client = new Client({ connectionString, application_name: 'axoros-sales-email-send-attempt-migration' });

try {
  await client.connect();
  await client.query('begin');
  await client.query(sql);
  await client.query('commit');
  console.log('PASS  Sales email send-attempt migration applied.');
} catch (error) {
  await client.query('rollback').catch(() => undefined);
  console.error(`FAIL  ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}
