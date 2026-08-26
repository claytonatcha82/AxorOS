import pg from 'pg';

import { createPilotActivationCommand } from '../apps/api/dist/agents/pilot-activation-command.js';
import { createPilotActivationCeremonyService } from '../apps/api/dist/agents/pilot-activation-ceremony-service.js';
import { createPilotReadinessAssessmentService } from '../apps/api/dist/agents/pilot-readiness-assessment-service.js';
import { PilotActivationCeremonyAuditPostgresStore } from '../apps/api/dist/data/pilot-activation-ceremony-audit-postgres-store.js';
import { PilotActivationReadinessPostgresStore } from '../apps/api/dist/data/pilot-activation-readiness-postgres-store.js';
import { PilotSystemStatePostgresStore } from '../apps/api/dist/data/pilot-system-state-postgres-store.js';
import { PilotVerificationEvidencePostgresStore } from '../apps/api/dist/data/pilot-verification-evidence-postgres-store.js';

const { Pool } = pg;
const connectionString = process.env.AXOROS_DATABASE_URL;
if (!connectionString) throw new Error('AXOROS_DATABASE_URL is required.');

const pool = new Pool({ connectionString, max: 2, application_name: 'axoros-pilot-activation-ceremony-verify' });
const evidenceStore = new PilotVerificationEvidencePostgresStore(pool);
const readinessStore = new PilotActivationReadinessPostgresStore(pool);
const auditStore = new PilotActivationCeremonyAuditPostgresStore(pool);
const realPilotState = new PilotSystemStatePostgresStore(pool);
const assessment = createPilotReadinessAssessmentService({ evidenceStore, readinessStore });
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const readinessId = `pilot-readiness:ceremony-verify:${suffix}`;
const categories = ['SYNTHETIC_LIFECYCLE','PERSISTED_RUNTIME','FINANCE_INTEGRITY','CONTROL_PLANE','DEPLOYMENT_SAFETY'];
const evidenceIds = categories.map((category) => `pilot-evidence:ceremony:${category.toLowerCase()}:${suffix}`);
const beforeRealState = await realPilotState.get();
if (beforeRealState.state !== 'PILOT_DISABLED') throw new Error(`Ceremony verifier requires real pilot state PILOT_DISABLED, received ${beforeRealState.state}.`);

let simulatedState = {
  state: 'PILOT_DISABLED',
  changedBy: 'verification_runner',
  reason: 'Simulated ceremony starts disabled.',
  version: 1,
  changedAt: new Date().toISOString(),
};
const simulatedPilotStateStore = {
  async get() { return simulatedState; },
  async set(state, changedBy, reason) {
    simulatedState = { state, changedBy, reason, version: simulatedState.version + 1, changedAt: new Date().toISOString() };
    return simulatedState;
  },
};
const activationCommand = createPilotActivationCommand({ readinessStore, pilotStateStore: simulatedPilotStateStore });
const ceremony = createPilotActivationCeremonyService({
  readinessStore,
  evidenceStore,
  pilotStateStore: simulatedPilotStateStore,
  activationCommand,
  auditStore,
});

try {
  for (let index = 0; index < categories.length; index += 1) {
    await evidenceStore.save({
      evidenceId: evidenceIds[index],
      category: categories[index],
      outcome: 'PASS',
      verifier: 'verify-pilot-activation-ceremony.mjs',
      sourceReference: `verification://ceremony/${categories[index].toLowerCase()}/${suffix}`,
      details: { ceremonyVerification: true, realPilotMutationAuthorised: false },
      verifiedAt: new Date().toISOString(),
    });
  }

  const assessed = await assessment.assess({ readinessId, evidenceIds, assessedBy: 'pilot_activation_ceremony_verifier' });
  if (assessed.state !== 'PILOT_ACTIVATION_READY') throw new Error(`Expected ready assessment, got ${assessed.state}.`);

  const preview = await ceremony.preview(readinessId);
  if (preview.evidence.length !== 5 || preview.pilotState.state !== 'PILOT_DISABLED') throw new Error('Ceremony preview did not expose five PASS receipts from disabled state.');

  let confirmationBlocked = false;
  try {
    await ceremony.activate({ readinessId, reason: 'Verify exact activation confirmation.', confirmation: 'activate pilot' });
  } catch (error) {
    confirmationBlocked = error instanceof Error && error.message.includes('exact confirmation ACTIVATE PILOT');
  }
  if (!confirmationBlocked) throw new Error('Incorrect activation confirmation was not rejected.');

  const activated = await ceremony.activate({ readinessId, reason: 'Simulated Human Executive activation ceremony.', confirmation: 'ACTIVATE PILOT' });
  if (activated.state.state !== 'PILOT_ACTIVE' || simulatedState.state !== 'PILOT_ACTIVE') throw new Error('Simulated ceremony did not reach PILOT_ACTIVE.');

  const disabled = await ceremony.deactivate({ readinessId, reason: 'Immediate simulated rollback proof.', confirmation: 'DISABLE PILOT' });
  if (disabled.state !== 'PILOT_DISABLED' || simulatedState.state !== 'PILOT_DISABLED') throw new Error('Simulated immediate rollback did not restore PILOT_DISABLED.');

  const auditRows = await pool.query(
    `select action, count(*)::int as count
       from runtime.pilot_activation_ceremony_audit
      where readiness_id = $1
      group by action`,
    [readinessId],
  );
  const counts = new Map(auditRows.rows.map((row) => [row.action, Number(row.count)]));
  if (counts.get('PREVIEWED') !== 1 || counts.get('ACTIVATION_APPROVED') !== 1 || counts.get('DEACTIVATION_PROVED') !== 1) {
    throw new Error(`Expected one audit record per ceremony phase, got ${JSON.stringify(Object.fromEntries(counts))}.`);
  }

  const afterRealState = await realPilotState.get();
  if (afterRealState.state !== beforeRealState.state || afterRealState.version !== beforeRealState.version || afterRealState.changedAt !== beforeRealState.changedAt) {
    throw new Error(`Real pilot singleton changed during ceremony verification: before=${JSON.stringify(beforeRealState)} after=${JSON.stringify(afterRealState)}`);
  }

  console.log('PASS  Human Executive activation ceremony preview validated five persisted PASS receipts.');
  console.log('PASS  Incorrect activation confirmation failed closed.');
  console.log('PASS  Exact ACTIVATE PILOT confirmation reached simulated PILOT_ACTIVE.');
  console.log('PASS  Exact DISABLE PILOT confirmation immediately restored simulated PILOT_DISABLED.');
  console.log('PASS  Preview, activation approval, and deactivation proof were immutably audited.');
  console.log(`Readiness ID: ${readinessId}`);
  console.log(`Real pilot state remained ${afterRealState.state} at version ${afterRealState.version}.`);
  console.log('No real pilot activation occurred.');
} finally {
  await pool.query('delete from runtime.pilot_activation_ceremony_audit where readiness_id = $1', [readinessId]).catch(() => undefined);
  await pool.query('delete from runtime.pilot_activation_readiness where readiness_id = $1', [readinessId]).catch(() => undefined);
  await pool.query('delete from runtime.pilot_verification_evidence where evidence_id = any($1::text[])', [evidenceIds]).catch(() => undefined);
  await pool.end().catch(() => undefined);
}
