import assert from 'node:assert/strict';
import pg from 'pg';
import { createFinanceLedgerEntry } from '../apps/api/dist/agents/finance-ledger-entry.js';
import {
  FinanceLedgerIntegrityConflictError,
  FinanceLedgerPostgresStore,
} from '../apps/api/dist/data/finance-ledger-postgres-store.js';

const { Pool } = pg;
const connectionString = process.env.AXOROS_DATABASE_URL;
if (!connectionString) {
  console.error('FAIL  AXOROS_DATABASE_URL is not set.');
  process.exit(1);
}

const pool = new Pool({
  connectionString,
  max: 2,
  application_name: 'axoros-finance-ledger-persistence-verifier',
});
const store = new FinanceLedgerPostgresStore(pool);
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const entryId = `finance-ledger:verify:${suffix}`;
const conflictingEntryId = `finance-ledger:verify:${suffix}:conflict`;
const commercialRecordReference = `commercial:finance-ledger:verify:${suffix}`;
const authorityReference = `payment-provider:paystack:verify:${suffix}`;
const occurredAt = new Date().toISOString();
const recordedAt = new Date(Date.now() + 1000).toISOString();

const entry = createFinanceLedgerEntry({
  entryId,
  entryType: 'PAYMENT_PROVIDER_STATE_OBSERVED',
  commercialRecordReference,
  authorityType: 'payment_provider_evidence',
  authorityReference,
  evidenceReferences: [authorityReference],
  amountMinor: 12500,
  currency: 'ZAR',
  occurredAt,
  recordedAt,
});

async function cleanup() {
  await pool.query(
    'delete from finance.ledger_entries where entry_id = any($1::text[])',
    [[entryId, conflictingEntryId]],
  );
}

try {
  const first = await store.save(entry);
  assert.equal(first, 'accepted');

  const persisted = await store.get(entryId);
  assert.deepEqual(persisted, entry);

  const duplicate = await store.save(entry);
  assert.equal(duplicate, 'duplicate');

  await assert.rejects(
    () => store.save({ ...entry, amountMinor: 13000 }),
    (error) => error instanceof FinanceLedgerIntegrityConflictError,
  );

  await assert.rejects(
    () => store.save({ ...entry, entryId: conflictingEntryId }),
    (error) => error instanceof FinanceLedgerIntegrityConflictError,
  );

  const afterConflicts = await store.get(entryId);
  assert.deepEqual(afterConflicts, entry);

  const authorityEntry = await store.getByAuthority(
    entry.entryType,
    entry.authorityType,
    authorityReference,
  );
  assert.deepEqual(authorityEntry, entry);

  const count = await pool.query(
    `select count(*)::int as count
       from finance.ledger_entries
      where authority_reference = $1`,
    [authorityReference],
  );
  assert.equal(count.rows[0]?.count, 1);

  console.log('PASS  Immutable Finance ledger accepts trusted authority once, treats exact retries as idempotent duplicates, rejects conflicting rewrites by entry ID or authority identity, and preserves the original historical evidence unchanged.');
} catch (error) {
  console.error(`FAIL  ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await cleanup().catch((error) => {
    console.error(`WARN  verifier cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
  await pool.end().catch(() => undefined);
}
