import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EXECUTIVE_AGENT_PERMISSIONS,
  classifyExecutiveDecision,
  executiveAgentIsProhibited,
} from './executive-agent-policy.js';

test('executive agent has summary-level read access and creates operations instructions', () => {
  assert.equal(EXECUTIVE_AGENT_PERMISSIONS.atlasOs, 'read');
  assert.equal(EXECUTIVE_AGENT_PERMISSIONS.financialSummaries, 'read');
  assert.equal(EXECUTIVE_AGENT_PERMISSIONS.operationsInstructions, 'create');
});

test('decision levels enforce human authority for material and human-only decisions', () => {
  assert.deepEqual(classifyExecutiveDecision(1), { level: 1, authority: 'autonomous', mayExecute: true, humanApprovalRequired: false });
  assert.deepEqual(classifyExecutiveDecision(2), { level: 2, authority: 'supervised', mayExecute: true, humanApprovalRequired: false });
  assert.deepEqual(classifyExecutiveDecision(3), { level: 3, authority: 'approval_required', mayExecute: false, humanApprovalRequired: true });
  assert.deepEqual(classifyExecutiveDecision(4), { level: 4, authority: 'human_only', mayExecute: false, humanApprovalRequired: true });
});

test('executive agent cannot execute specialist, financial, legal, or deployment actions directly', () => {
  assert.equal(executiveAgentIsProhibited('payment_execution'), true);
  assert.equal(executiveAgentIsProhibited('production_deployment'), true);
  assert.equal(executiveAgentIsProhibited('contract_execution'), true);
  assert.equal(executiveAgentIsProhibited('sales_email_sending'), true);
  assert.equal(executiveAgentIsProhibited('website_building'), true);
  assert.equal(executiveAgentIsProhibited('create_operations_instruction'), false);
});
