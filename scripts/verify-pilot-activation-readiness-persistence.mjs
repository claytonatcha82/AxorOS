import pg from 'pg';
import {
  PilotActivationReadinessIntegrityConflictError,
  PilotActivationReadinessPostgresStore,
} from '../apps/api/dist/data/pilot-activation-readiness-postgres-store.js';

const { Pool } = pg;
const connectionString = process.env.AXOROS_DATABASE_URL;
if (!connectionString) {
  console.error('FAIL  AXOROS_DATABASE_URL is not set.');
  process.exit(1);
}

const pool = new Pool({
  connectionString,
  max: 1,
  application_name: 'axoros-pilot-activation-readiness-verify',
});
const store = new PilotActivationReadinessPostgresStore(pool);
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const readinessId = `pilot-readiness:verify:${suffix}`;
const assessedAt = new Date().toISOString();
const record = {
  readinessId,
  state: 'PILOT_ACTIVATION_READY',
  syntheticLifecycleVerified: true,
  persistedRuntimeVerified: true,
  financeIntegrityVerified: true,
  controlPlaneVerified: true,
  deploymentSafetyVerified: true,
  evidenceReferences: [
    `stage1:${suffix}:synthetic-lifecycle`,
    `runtime:${suffix}:persistence`,
    `finance:${suffix}:integrity`,
    `control-plane:${suffix}:approval`,
    `deployment:${suffix}:safety`,
  ],
  assessedBy: 'operations_agent:verification',
  assessedAt,
};

try {
  const first = await store.save(record);
  if (first !== 'accepted') throw new Error(`Expected accepted persistence, got ${first}.`);

  const persisted = await store.get(readinessId);
  if (!persisted) throw new Error('Persisted pilot activation readiness record was not found.');
  if (persisted.state !== 'PILOT_ACTIVATION_READY') throw new Error(`Unexpected persisted state ${persisted.state}.`);
  if (!persisted.syntheticLifecycleVerified
    || !persisted.persistedRuntimeVerified
    || !persisted.financeIntegrityVerified
    || !persisted.controlPlaneVerified
    || !persisted.deploymentSafetyVerified) {
    throw new Error('Persisted readiness lost one or more verification gates.');
  }
  if (persisted.evidenceReferences.length !== record.evidenceReferences.length) {
    throw new Error('Persisted readiness evidence references are incomplete.');
  }

  const replay = await store.save(record);
  if (replay !== 'replayed') throw new Error(`Expected replayed persistence, got ${replay}.`);

  let conflictObserved = false;
  try {
    await store.save({ ...record, deploymentSafetyVerified: false, state: 'PILOT_ACTIVATION_BLOCKED' });
  } catch (error) {
    if (error instanceof PilotActivationReadinessIntegrityConflictError) conflictObserved = true;
    else throw error;
  }
  if (!conflictObserved) throw new Error('Expected immutable readiness integrity conflict was not observed.');

  let invalidReadyRejected = false;
  try {
    await store.save({
      ...record,
      readinessId: `${readinessId}:invalid`,
      financeIntegrityVerified: false,
    });
  } catch (error) {
    invalidReadyRejected = error instanceof Error
      && /requires every system verification gate to pass/.test(error.message);
  }
  if (!invalidReadyRejected) throw new Error('Invalid PILOT_ACTIVATION_READY record was not rejected.');

  console.log('PASS  Pilot activation readiness persistence is immutable and fail closed.');
  console.log(`Readiness ID: ${readinessId}`);
  console.log('No pilot system-state mutation was attempted. PILOT_DISABLED/PILOT_ACTIVE was not changed.');
} finally {
  await pool.query('delete from runtime.pilot_activation_readiness where readiness_id in ($1, $2)', [readinessId, `${readinessId}:invalid`]).catch(() => undefined);
  await pool.end().catch(() => undefined);
}
