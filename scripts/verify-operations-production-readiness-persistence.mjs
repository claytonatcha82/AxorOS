import pg from 'pg';
import {
  OperationsProductionReadinessIntegrityConflictError,
  OperationsProductionReadinessPostgresStore,
} from '../apps/api/dist/data/operations-production-readiness-postgres-store.js';

const { Client } = pg;
const connectionString = process.env.AXOROS_DATABASE_URL;
if (!connectionString) {
  console.error('FAIL  AXOROS_DATABASE_URL is not set.');
  process.exit(1);
}

const client = new Client({ connectionString, application_name: 'axoros-operations-production-readiness-verify' });
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const readinessId = `operations-readiness:verify:${suffix}`;
const decision = {
  readinessId,
  commercialRecordReference: `commercial:operations-readiness:${suffix}`,
  state: 'OPERATIONS_READY',
  contractSigned: true,
  onboardingComplete: true,
  assetsAvailable: true,
  planningComplete: true,
  evidenceReferences: [`operations-evidence:verify:${suffix}`],
  approvedBy: 'operations_agent',
  approvedAt: new Date().toISOString(),
};

try {
  await client.connect();
  await client.query('begin');
  const store = new OperationsProductionReadinessPostgresStore(client);

  const accepted = await store.save(decision);
  if (accepted !== 'accepted') throw new Error(`expected accepted persistence, received ${accepted}.`);

  const replayed = await store.save(decision);
  if (replayed !== 'replayed') throw new Error(`expected exact replay, received ${replayed}.`);

  let conflictRejected = false;
  try {
    await store.save({ ...decision, planningComplete: false, state: 'OPERATIONS_BLOCKED' });
  } catch (error) {
    conflictRejected = error instanceof OperationsProductionReadinessIntegrityConflictError;
  }
  if (!conflictRejected) throw new Error('conflicting readiness replay was not rejected fail-closed.');

  let incompleteReadyRejected = false;
  try {
    await store.save({
      ...decision,
      readinessId: `${readinessId}:incomplete`,
      assetsAvailable: false,
    });
  } catch (error) {
    incompleteReadyRejected = error instanceof Error && error.message.includes('requires contract, onboarding, assets, and planning completion');
  }
  if (!incompleteReadyRejected) throw new Error('incomplete OPERATIONS_READY decision was not rejected.');

  const persisted = await store.get(readinessId);
  if (!persisted || persisted.state !== 'OPERATIONS_READY' || !persisted.contractSigned || !persisted.onboardingComplete || !persisted.assetsAvailable || !persisted.planningComplete) {
    throw new Error('authoritative Operations readiness record was not preserved.');
  }

  await client.query('rollback');
  console.log('PASS  Operations Production readiness persists immutable governed evidence, permits exact replay, rejects conflicting replay, and cannot mark incomplete prerequisites OPERATIONS_READY.');
} catch (error) {
  await client.query('rollback').catch(() => undefined);
  console.error(`FAIL  ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}
