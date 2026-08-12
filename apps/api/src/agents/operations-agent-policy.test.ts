import assert from 'node:assert/strict';
import test from 'node:test';
import { OPERATIONS_AGENT_PERMISSIONS, operationsAgentIsProhibited } from './operations-agent-policy.js';

test('operations agent has coordination permissions without specialist authority', () => {
  assert.equal(OPERATIONS_AGENT_PERMISSIONS.atlasOs, 'read');
  assert.equal(OPERATIONS_AGENT_PERMISSIONS.taskSystem, 'read_create_update');
  assert.equal(OPERATIONS_AGENT_PERMISSIONS.crmWorkflowStatus, 'read_update');
  assert.equal(OPERATIONS_AGENT_PERMISSIONS.calendarCoordination, 'limited_write');
});

test('operations agent prohibits high-risk and specialist-owned actions', () => {
  assert.equal(operationsAgentIsProhibited('payment_execution'), true);
  assert.equal(operationsAgentIsProhibited('contract_signing'), true);
  assert.equal(operationsAgentIsProhibited('pricing_authority'), true);
  assert.equal(operationsAgentIsProhibited('default_production_deployment'), true);
  assert.equal(operationsAgentIsProhibited('legal_approval'), true);
  assert.equal(operationsAgentIsProhibited('coordinate_workflow'), false);
});
