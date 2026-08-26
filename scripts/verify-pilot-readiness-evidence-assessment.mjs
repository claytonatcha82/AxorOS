import pg from 'pg';
import { PilotActivationReadinessPostgresStore } from '../apps/api/dist/data/pilot-activation-readiness-postgres-store.js';
import { PilotVerificationEvidencePostgresStore } from '../apps/api/dist/data/pilot-verification-evidence-postgres-store.js';
import { PilotSystemStatePostgresStore } from '../apps/api/dist/data/pilot-system-state-postgres-store.js';
import { createPilotReadinessAssessmentService } from '../apps/api/dist/agents/pilot-readiness-assessment-service.js';

const { Pool } = pg;
const connectionString = process.env.AXOROS_DATABASE_URL;
if (!connectionString) throw new Error('AXOROS_DATABASE_URL is required.');

const pool = new Pool({ connectionString, max: 1, application_name: 'axoros-pilot-readiness-evidence-assessment-verify' });
const evidenceStore = new PilotVerificationEvidencePostgresStore(pool);
const readinessStore = new PilotActivationReadinessPostgresStore(pool);
const pilotStateStore = new PilotSystemStatePostgresStore(pool);
const service = createPilotReadinessAssessmentService({ evidenceStore, readinessStore });
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const categories = [
  'SYNTHETIC_LIFECYCLE',
  'PERSISTED_RUNTIME',
  'FINANCE_INTEGRITY',
  'CONTROL_PLANE',
  'DEPLOYMENT_SAFETY',
];
const evidenceIds = categories.map((category) => `pilot-evidence:verify:${category.toLowerCase()}:${suffix}`);
const readinessId = `pilot-readiness:evidence-verify:${suffix}`;
const beforeState = await pilotStateStore.get();

try {
  for (let index = 0; index < categories.length; index += 1) {
    await evidenceStore.save({
      evidenceId: evidenceIds[index],
      category: categories[index],
      outcome: 'PASS',
      verifier: 'verify-pilot-readiness-evidence-assessment.mjs',
      sourceReference: `verification://pilot/${categories[index].toLowerCase()}/${suffix}`,
      details: { syntheticVerification: true, externalSideEffect: false },
      verifiedAt: new Date().toISOString(),
    });
  }

  const result = await service.assess({
    readinessId,
    evidenceIds,
    assessedBy: 'verification_runner',
  });
  if (result.state !== 'PILOT_ACTIVATION_READY') throw new Error(`Expected PILOT_ACTIVATION_READY, got ${result.state}.`);

  const persisted = await readinessStore.get(readinessId);
  if (!persisted || persisted.state !== 'PILOT_ACTIVATION_READY') throw new Error('Persisted readiness assessment was not READY.');
  if (persisted.evidenceReferences.length !== 5) throw new Error('Persisted readiness assessment is missing evidence lineage.');

  const afterState = await pilotStateStore.get();
  if (afterState.state !== beforeState.state || afterState.version !== beforeState.version) {
    throw new Error('Pilot system state changed during readiness evidence verification.');
  }

  console.log('PASS  Pilot readiness is derived from five persisted verification receipts.');
  console.log(`Readiness ID: ${readinessId}`);
  console.log(`Evidence receipts: ${evidenceIds.length}`);
  console.log(`Pilot state remained ${afterState.state} at version ${afterState.version}.`);
  console.log('No pilot activation occurred.');
} finally {
  await pool.query('delete from runtime.pilot_activation_readiness where readiness_id = $1', [readinessId]).catch(() => undefined);
  await pool.query('delete from runtime.pilot_verification_evidence where evidence_id = any($1::text[])', [evidenceIds]).catch(() => undefined);
  await pool.end().catch(() => undefined);
}
