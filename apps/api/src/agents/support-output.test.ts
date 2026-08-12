import assert from 'node:assert/strict';
import test from 'node:test';
import { maintenanceAction, validateSupportOutput } from './support-output.js';

test('support cannot close a request without validated resolution and communication', () => {
  const errors = validateSupportOutput({ supportRequestId: 's1', clientId: 'c1', classification: 'bug', severity: 'P3', entitlementStatus: 'included', issueSummary: 'Form failure', evidence: ['monitor-1'], diagnosis: 'API error', actionTaken: 'fixed', validationResult: '', clientCommunication: '', escalationStatus: 'none', followupRequired: false, commercialOpportunity: null, knowledgeReferences: [], closed: true });
  assert.ok(errors.includes('closed support requests require validationResult.'));
  assert.ok(errors.includes('closed support requests require clientCommunication.'));
});

test('risky maintenance remains tested and approval gated', () => {
  assert.equal(maintenanceAction({ changeType: 'production_code', testPassed: true, approvalGranted: false }), 'approval_required');
  assert.equal(maintenanceAction({ changeType: 'dependency', testPassed: false, approvalGranted: true }), 'block');
  assert.equal(maintenanceAction({ changeType: 'security_patch', testPassed: true, approvalGranted: true }), 'apply');
});
