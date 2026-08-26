import { spawnSync } from 'node:child_process';
import pg from 'pg';

import { createPilotReadinessAssessmentService } from '../apps/api/dist/agents/pilot-readiness-assessment-service.js';
import { PilotActivationReadinessPostgresStore } from '../apps/api/dist/data/pilot-activation-readiness-postgres-store.js';
import { PilotSystemStatePostgresStore } from '../apps/api/dist/data/pilot-system-state-postgres-store.js';
import { PilotVerificationEvidencePostgresStore } from '../apps/api/dist/data/pilot-verification-evidence-postgres-store.js';

const { Pool } = pg;

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required via Infisical.`);
  return value;
}

const connectionString = required('AXOROS_DATABASE_URL');
required('AXOROS_CONTROL_PLANE_TOKEN');

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const readinessId = `pilot-readiness:evidence-suite:${suffix}`;
const pool = new Pool({
  connectionString,
  max: 2,
  application_name: 'axoros-pilot-readiness-evidence-suite',
});
const evidenceStore = new PilotVerificationEvidencePostgresStore(pool);
const readinessStore = new PilotActivationReadinessPostgresStore(pool);
const pilotStateStore = new PilotSystemStatePostgresStore(pool);
const assessment = createPilotReadinessAssessmentService({ evidenceStore, readinessStore });

const steps = [
  {
    category: 'SYNTHETIC_LIFECYCLE',
    label: 'Stage 1 consolidated synthetic lifecycle',
    script: 'scripts/verify-stage1-synthetic-lifecycle.mjs',
  },
  {
    category: 'PERSISTED_RUNTIME',
    label: 'Persisted Production runtime authority',
    script: 'scripts/verify-production-persisted-runtime.mjs',
  },
  {
    category: 'FINANCE_INTEGRITY',
    label: 'Finance immutable full-ledger lifecycle',
    script: 'scripts/verify-finance-full-ledger-lifecycle-runtime.mjs',
  },
  {
    category: 'CONTROL_PLANE',
    label: 'Authenticated fail-closed pilot activation control plane',
    script: 'scripts/verify-pilot-activation-control-plane.mjs',
  },
  {
    category: 'DEPLOYMENT_SAFETY',
    label: 'Strict deployment authority and global pilot kill switch',
    script: 'scripts/verify-stage1-synthetic-deployment-boundary.mjs',
  },
];

const evidenceIds = [];
const beforeState = await pilotStateStore.get();

if (beforeState.state !== 'PILOT_DISABLED') {
  throw new Error(`Evidence suite requires PILOT_DISABLED before verification; current state is ${beforeState.state}.`);
}

console.log('\nAxorOS Pilot Readiness — Evidence-Backed Verification Suite');
console.log('==========================================================');
console.log('Every PASS receipt is persisted only after its real verifier exits successfully.');
console.log('This suite is not authorised to activate the pilot.\n');

try {
  for (const [index, step] of steps.entries()) {
    console.log(`\n[${index + 1}/${steps.length}] ${step.label}`);
    console.log('-'.repeat(76));

    const result = spawnSync(process.execPath, [step.script], {
      stdio: 'inherit',
      env: process.env,
    });

    if (result.error) {
      throw new Error(`Could not execute ${step.script}: ${result.error.message}`);
    }
    if (result.status !== 0) {
      throw new Error(`${step.label} failed with exit status ${result.status ?? 'unknown'}. No PASS receipt was written.`);
    }

    const evidenceId = `pilot-evidence:suite:${step.category.toLowerCase()}:${suffix}`;
    const persisted = await evidenceStore.save({
      evidenceId,
      category: step.category,
      outcome: 'PASS',
      verifier: 'verify-pilot-readiness-evidence-suite.mjs',
      sourceReference: `script://${step.script}`,
      details: {
        label: step.label,
        script: step.script,
        processExitStatus: 0,
        suiteRunId: suffix,
        externalActivationAuthorised: false,
      },
      verifiedAt: new Date().toISOString(),
    });
    if (persisted !== 'accepted') {
      throw new Error(`${step.category} evidence receipt was not newly accepted.`);
    }
    evidenceIds.push(evidenceId);
    console.log(`PASS receipt persisted: ${evidenceId}`);
  }

  const readiness = await assessment.assess({
    readinessId,
    evidenceIds,
    assessedBy: 'pilot_readiness_evidence_suite',
  });

  if (readiness.state !== 'PILOT_ACTIVATION_READY') {
    throw new Error(`Expected PILOT_ACTIVATION_READY assessment, received ${readiness.state}.`);
  }
  if (readiness.evidence.length !== 5) {
    throw new Error(`Expected 5 assessment evidence records, received ${readiness.evidence.length}.`);
  }

  const persistedReadiness = await readinessStore.get(readinessId);
  if (!persistedReadiness) {
    throw new Error('Evidence-backed readiness assessment was not persisted.');
  }
  if (persistedReadiness.state !== 'PILOT_ACTIVATION_READY') {
    throw new Error(`Persisted readiness expected PILOT_ACTIVATION_READY, received ${persistedReadiness.state}.`);
  }
  if (persistedReadiness.evidenceReferences.length !== 5) {
    throw new Error(`Expected 5 persisted readiness evidence references, received ${persistedReadiness.evidenceReferences.length}.`);
  }
  const expectedReferences = evidenceIds.map((evidenceId) => `pilot-verification:${evidenceId}`);
  if (JSON.stringify(persistedReadiness.evidenceReferences) !== JSON.stringify(expectedReferences)) {
    throw new Error('Persisted readiness evidence lineage does not exactly match the five verification receipts.');
  }

  const afterState = await pilotStateStore.get();
  if (
    afterState.state !== beforeState.state
    || afterState.version !== beforeState.version
    || afterState.changedAt !== beforeState.changedAt
  ) {
    throw new Error(
      `Pilot system state mutated during evidence suite: before=${JSON.stringify(beforeState)} after=${JSON.stringify(afterState)}`,
    );
  }

  console.log('\n==========================================================');
  console.log('PASS  Five real verification runners produced five immutable PASS receipts.');
  console.log(`PASS  Evidence-backed readiness derived as ${readiness.state}.`);
  console.log('PASS  Persisted readiness lineage exactly matches all five verification receipts.');
  console.log(`Readiness ID: ${readinessId}`);
  console.log(`Evidence receipts: ${evidenceIds.length}`);
  console.log(`Pilot state remained ${afterState.state} at version ${afterState.version}.`);
  console.log('No pilot activation occurred.');
} catch (error) {
  console.error(`\nFAIL  ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await pool.end().catch(() => undefined);
}
