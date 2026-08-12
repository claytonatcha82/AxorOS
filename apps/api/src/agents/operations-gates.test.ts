import assert from 'node:assert/strict';
import test from 'node:test';
import { criticalIssueSeverity, operationsExceptionAction, productionMayStart, qualityGateDecision } from './operations-gates.js';

test('operations handles routine warning escalation and critical exceptions at the correct layer', () => {
  assert.equal(operationsExceptionAction('routine'), 'record_complete');
  assert.equal(operationsExceptionAction('warning'), 'adjust_workflow');
  assert.equal(operationsExceptionAction('escalation'), 'notify_executive_agent');
  assert.equal(operationsExceptionAction('critical'), 'notify_human_executive');
  assert.equal(criticalIssueSeverity('security'), 'critical');
  assert.equal(criticalIssueSeverity('financial'), 'critical');
});

test('production cannot start when deposit or another mandatory process gate is missing', () => {
  const result = productionMayStart({ contractSigned: true, depositConfirmed: false, onboardingComplete: true, assetsReceived: true, planningComplete: true });
  assert.equal(result.allowed, false);
  assert.deepEqual(result.missing, ['depositConfirmed']);
});

test('production starts only after all mandatory gates pass', () => {
  assert.deepEqual(productionMayStart({ contractSigned: true, depositConfirmed: true, onboardingComplete: true, assetsReceived: true, planningComplete: true }), { allowed: true, missing: [] });
});

test('failed internal QA routes work to rework before client review', () => {
  assert.equal(qualityGateDecision({ productionComplete: true, internalQaRequired: true, internalQaPassed: false, clientReviewReady: true }), 'rework');
  assert.equal(qualityGateDecision({ productionComplete: true, internalQaRequired: true, internalQaPassed: true, clientReviewReady: true }), 'client_review');
});
