import assert from 'node:assert/strict';
import test from 'node:test';
import { supportActivationGate, type SupportHandover } from './support-handover.js';

function validHandover(): SupportHandover {
  return {
    projectId: 'project-1', clientId: 'client-1', productionUrl: 'https://example.com', technologyStack: ['React'], repository: 'repo', hosting: 'hosting', domain: 'example.com', deploymentPlatform: 'Vercel', integrations: [], monitoringRequirements: ['uptime'], backupProcess: 'documented', maintenancePlan: 'basic', supportEntitlement: 'basic', credentialsReference: 'secret://client-1/site', knownLimitations: [], clientContacts: ['contact'], documentation: ['runbook'], renewalDates: [], openItems: [], websiteLive: true, postLaunchValidationPassed: true, technicalDocumentationComplete: true, credentialsReferencedSecurely: true, maintenanceRequirementsDefined: true, clientHandoverComplete: true,
  };
}

test('support activates only after complete production handover', () => {
  assert.deepEqual(supportActivationGate(validHandover()), { allowed: true, missing: [] });
});

test('incomplete documentation blocks formal support activation', () => {
  const handover = validHandover();
  handover.technicalDocumentationComplete = false;
  assert.deepEqual(supportActivationGate(handover), { allowed: false, missing: ['technicalDocumentationComplete'] });
});

test('raw credential absence is not solved by embedding credentials; a secure reference is required', () => {
  const handover = validHandover();
  handover.credentialsReference = '';
  handover.credentialsReferencedSecurely = false;
  const result = supportActivationGate(handover);
  assert.equal(result.allowed, false);
  assert.ok(result.missing.includes('credentialsReference'));
});
