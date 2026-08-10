import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertDeploymentRecordSafe,
  assertSupportHandoverReady,
  validatePostLaunch,
  validateSupportHandover,
  type ProductionDeploymentRecord,
  type SupportHandover,
} from './production-delivery-lifecycle.js';

function deploymentRecord(): ProductionDeploymentRecord {
  return {
    deploymentId: 'dep-001',
    previousVersion: 'v1.0.0',
    newVersion: 'v1.1.0',
    backupStatus: 'ready',
    rollbackMethod: 'Redeploy v1.0.0 from the approved release artifact.',
    validationStatus: 'pending',
    deployedAt: '2026-08-10T21:00:00Z',
  };
}

function supportHandover(): SupportHandover {
  return {
    projectId: 'project-001',
    productionUrl: 'https://example.com',
    hosting: 'Vercel',
    domain: 'example.com',
    deploymentPlatform: 'Vercel',
    repository: 'client/example-site',
    technologyStack: ['React', 'Vite'],
    integrations: ['Contact form'],
    maintenanceRequirements: ['Monthly dependency review'],
    monitoringRequirements: ['Availability monitoring'],
    backupProcess: 'Use platform rollback and repository release tags.',
    knownLimitations: [],
    credentialsReference: 'Infisical project/client-example production path',
    clientTrainingRequired: false,
    documentation: ['README', 'deployment runbook'],
    outstandingItems: [],
  };
}

test('safe deployment record requires backup and rollback readiness', () => {
  assert.doesNotThrow(() => assertDeploymentRecordSafe(deploymentRecord()));
  const unsafe = deploymentRecord();
  unsafe.backupStatus = 'not_ready';
  assert.throws(() => assertDeploymentRecordSafe(unsafe), /backup must be ready/);
});

test('post-launch validation fails if any production check fails', () => {
  const result = validatePostLaunch({
    siteAvailable: true,
    domainValid: true,
    sslValid: true,
    navigationValid: true,
    formsValid: false,
    analyticsValid: true,
    seoEssentialsValid: true,
    mobileRenderingValid: true,
    criticalIntegrationsValid: true,
    noProductionOnlyErrors: false,
  });
  assert.equal(result.passed, false);
  assert.deepEqual(result.failedChecks, ['formsValid', 'noProductionOnlyErrors']);
});

test('post-launch validation passes only when every required check succeeds', () => {
  const result = validatePostLaunch({
    siteAvailable: true,
    domainValid: true,
    sslValid: true,
    navigationValid: true,
    formsValid: true,
    analyticsValid: true,
    seoEssentialsValid: true,
    mobileRenderingValid: true,
    criticalIntegrationsValid: true,
    noProductionOnlyErrors: true,
  });
  assert.equal(result.passed, true);
  assert.deepEqual(result.failedChecks, []);
});

test('support handover is complete and references secure credentials instead of raw secrets', () => {
  const handover = supportHandover();
  assert.deepEqual(validateSupportHandover(handover), []);
  assert.doesNotThrow(() => assertSupportHandoverReady(handover));
});

test('support handover rejects raw credential material', () => {
  const handover = supportHandover();
  handover.credentialsReference = 'password: hunter2';
  const errors = validateSupportHandover(handover);
  assert.ok(errors.some((error) => error.includes('must not contain raw credentials')));
  assert.throws(() => assertSupportHandoverReady(handover), /Support handover is not ready/);
});
