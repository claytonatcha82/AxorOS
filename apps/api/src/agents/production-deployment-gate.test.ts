import assert from 'node:assert/strict';
import test from 'node:test';
import { assertProductionDeploymentReady, evaluateProductionDeploymentGate } from './production-deployment-gate.js';

test('deployment stays blocked when any QA or approval requirement fails', () => {
  const result = evaluateProductionDeploymentGate({
    codeQaPassed: true,
    functionalQaPassed: true,
    visualQaPassed: false,
    businessQaPassed: true,
    clientApproved: true,
    requiredFinalPaymentConditionMet: true,
    rollbackPrepared: true,
    seoChecked: true,
    securityChecked: false,
    deploymentApproved: true,
  });

  assert.equal(result.status, 'blocked');
  assert.equal(result.deploymentUnlocked, false);
  assert.deepEqual(result.failedRequirements, ['visualQaPassed', 'securityChecked']);
});

test('deployment unlocks only when every production gate requirement passes', () => {
  const input = {
    codeQaPassed: true,
    functionalQaPassed: true,
    visualQaPassed: true,
    businessQaPassed: true,
    clientApproved: true,
    requiredFinalPaymentConditionMet: true,
    rollbackPrepared: true,
    seoChecked: true,
    securityChecked: true,
    deploymentApproved: true,
  };

  const result = evaluateProductionDeploymentGate(input);
  assert.equal(result.status, 'go_live');
  assert.equal(result.deploymentUnlocked, true);
  assert.deepEqual(result.failedRequirements, []);
  assert.doesNotThrow(() => assertProductionDeploymentReady(input));
});

test('deployment assertion reports exactly what is blocking launch', () => {
  assert.throws(
    () => assertProductionDeploymentReady({
      codeQaPassed: true,
      functionalQaPassed: true,
      visualQaPassed: true,
      businessQaPassed: true,
      clientApproved: false,
      requiredFinalPaymentConditionMet: false,
      rollbackPrepared: true,
      seoChecked: true,
      securityChecked: true,
      deploymentApproved: false,
    }),
    /clientApproved, requiredFinalPaymentConditionMet, deploymentApproved/,
  );
});
