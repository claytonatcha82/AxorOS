import fs from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';

const { Client } = pg;
const connectionString = process.env.AXOROS_DATABASE_URL;
if (!connectionString) {
  console.error('FAIL  AXOROS_DATABASE_URL is not set.');
  process.exit(1);
}

const migrationPath = path.resolve(
  'infra/supabase/migrations/202608182145_finance_commercial_payment_satisfactions.sql',
);
const sql = await fs.readFile(migrationPath, 'utf8');
const client = new Client({
  connectionString,
  application_name: 'axoros-commercial-payment-satisfaction-migration',
});

try {
  await client.connect();
  await client.query('begin');
  await client.query(sql);
  await client.query('commit');
  console.log('PASS  Commercial payment satisfaction persistence migration applied.');
} catch (error) {
  await client.query('rollback').catch(() => undefined);
  console.error(`FAIL  ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}
