import fs from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';

const { Client } = pg;
const connectionString = process.env.AXOROS_DATABASE_URL;
if (!connectionString) {
  console.error('FAIL  AXOROS_DATABASE_URL is not set.');
  process.exit(1);
}

const migrationPath = path.resolve('supabase/migrations/20260819195000_create_lead_preliminary_qualifications.sql');
const sql = await fs.readFile(migrationPath, 'utf8');
const maxAttempts = 3;

function isTransientConnectionError(error) {
  if (!(error instanceof Error)) return false;
  const code = typeof error.code === 'string' ? error.code : '';
  const message = error.message.toLowerCase();
  return ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EPIPE', '57P01', '57P02', '57P03', '08000', '08003', '08006'].includes(code)
    || message.includes('connection terminated unexpectedly')
    || message.includes('connection terminated')
    || message.includes('connection reset')
    || message.includes('read econnreset');
}

function delay(milliseconds) { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }

async function schemaAlreadyPresent(client) {
  const result = await client.query(`
    select
      to_regclass('operational.lead_preliminary_qualifications') is not null as table_exists,
      exists (
        select 1 from pg_constraint
        where conrelid = 'operational.lead_preliminary_qualifications'::regclass
          and contype = 'c'
          and pg_get_constraintdef(oid) ilike '%human_review_required = true%'
      ) as human_review_constraint_exists
  `).catch((error) => {
    if (error?.code === '42P01') return { rows: [{ table_exists: false, human_review_constraint_exists: false }] };
    throw error;
  });
  return result.rows[0]?.table_exists === true && result.rows[0]?.human_review_constraint_exists === true;
}

async function applyMigration(attempt) {
  const client = new Client({ connectionString, application_name: `axoros-lead-qualification-migration-${attempt}`, connectionTimeoutMillis: 15000 });
  let connected = false;
  try {
    await client.connect();
    connected = true;
    if (await schemaAlreadyPresent(client)) return 'already_applied';
    await client.query(sql);
    return 'applied';
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
    const result = await applyMigration(attempt);
    console.log(result === 'already_applied'
      ? 'PASS  Preliminary lead qualification persistence migration already applied and schema guard verified.'
      : 'PASS  Preliminary lead qualification persistence migration applied.');
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
