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
const maxAttempts = 3;

function isTransientConnectionError(error) {
  if (!(error instanceof Error)) return false;
  const code = typeof error.code === 'string' ? error.code : '';
  const message = error.message.toLowerCase();
  return [
    'ECONNRESET',
    'ETIMEDOUT',
    'ECONNREFUSED',
    'EPIPE',
    '57P01',
    '57P02',
    '57P03',
    '08000',
    '08003',
    '08006',
  ].includes(code)
    || message.includes('connection terminated unexpectedly')
    || message.includes('connection terminated')
    || message.includes('connection reset')
    || message.includes('read econnreset');
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function applyMigration(attempt) {
  const client = new Client({
    connectionString,
    application_name: `axoros-commercial-payment-satisfaction-migration-${attempt}`,
    connectionTimeoutMillis: 15000,
  });

  let connected = false;
  try {
    await client.connect();
    connected = true;
    await client.query('begin');
    await client.query(sql);
    await client.query('commit');
  } catch (error) {
    if (connected) await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    await client.end().catch(() => undefined);
  }
}

let lastError;
for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
  try {
    await applyMigration(attempt);
    console.log('PASS  Commercial payment satisfaction persistence migration applied.');
    process.exit(0);
  } catch (error) {
    lastError = error;
    if (!isTransientConnectionError(error) || attempt === maxAttempts) break;
    console.warn(`WARN  Transient PostgreSQL connection failure on attempt ${attempt}/${maxAttempts}; retrying with a fresh connection.`);
    await delay(500 * attempt);
  }
}

console.error(`FAIL  ${lastError instanceof Error ? lastError.message : String(lastError)}`);
process.exit(1);
