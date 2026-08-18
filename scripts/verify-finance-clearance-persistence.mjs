import pg from 'pg';
import {
  FinanceClearanceIntegrityConflictError,
  FinanceClearancePostgresStore,
} from '../apps/api/dist/data/finance-clearance-postgres-store.js';

const { Client } = pg;
const connectionString = process.env.AXOROS_DATABASE_URL;
if (!connectionString) {
  console.error('FAIL  AXOROS_DATABASE_URL is not set.');
  process.exit(1);
}

const client = new Client({ connectionString, application_name: 'axoros-finance-clearance-verify' });
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const clearanceId = `finance-clearance:verify:${suffix}`;
const decision = {
  clearanceId,
  commercialRecordReference: `commercial:${suffix}`,
  providerPaymentReference: `pay-${suffix}`,
  state: 'FINANCE_CLEARED',
  reason: 'Live development database verification.',
  evidenceReferences: [`payment-provider:axoros-verification:evt-${suffix}`],
  amountMinor: 100,
  currency: 'ZAR',
  verifiedAt: new Date().toISOString(),
};

try {
  await client.connect();
  await client.query('begin');
  const store = new FinanceClearancePostgresStore(client);

  const first = await store.save(decision);
  if (first !== 'accepted') throw new Error(`expected first persistence to be accepted, received ${first}.`);

  const replay = await store.save(decision);
  if (replay !== 'duplicate') throw new Error(`expected exact replay to be duplicate, received ${replay}.`);

  let conflictDetected = false;
  try {
    await store.save({ ...decision, amountMinor: decision.amountMinor + 1 });
  } catch (error) {
    if (error instanceof FinanceClearanceIntegrityConflictError) conflictDetected = true;
    else throw error;
  }
  if (!conflictDetected) throw new Error('conflicting Finance clearance reuse was not rejected.');

  const persisted = await store.get(clearanceId);
  if (!persisted) throw new Error('authoritative Finance clearance could not be reloaded.');
  if (persisted.amountMinor !== decision.amountMinor) throw new Error('conflicting reuse altered the authoritative Finance clearance.');

  await client.query('rollback');
  console.log('PASS  Finance clearance persistence, exact replay, and conflict integrity verified.');
} catch (error) {
  await client.query('rollback').catch(() => undefined);
  console.error(`FAIL  ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}
