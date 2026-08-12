import assert from 'node:assert/strict';
import test from 'node:test';
import { canTransitionOperationsTask, validateOperationsTask, type OperationsTask } from './operations-task-contract.js';

function validTask(): OperationsTask {
  return {
    taskId: 'TASK-001', originAgent: 'executive_agent', destinationAgent: 'sales_agent',
    objective: 'Follow up Prospect A', priority: 'critical', context: ['Proposal-stage opportunity'],
    knowledgeReferences: ['ATLAS-SALES-001'], inputs: ['CRM summary'], expectedOutput: 'Follow-up outcome and CRM update',
    dependencies: [], risks: ['Client delay'], confidence: 0.94, approvalRequired: false,
    deadline: '2026-08-14T16:00:00+02:00', status: 'queued', nextAction: 'Validate task readiness',
  };
}

test('complete inter-agent task contract is accepted', () => {
  assert.deepEqual(validateOperationsTask(validTask()), []);
});

test('approval-gated task requires an approval owner', () => {
  const task = validTask();
  task.approvalRequired = true;
  assert.ok(validateOperationsTask(task).includes('approvalOwner is required when approvalRequired is true.'));
});

test('workflow state machine allows valid progress and blocks invalid jumps', () => {
  assert.equal(canTransitionOperationsTask('queued', 'ready'), true);
  assert.equal(canTransitionOperationsTask('ready', 'in_progress'), true);
  assert.equal(canTransitionOperationsTask('in_progress', 'review'), true);
  assert.equal(canTransitionOperationsTask('review', 'completed'), true);
  assert.equal(canTransitionOperationsTask('queued', 'completed'), false);
  assert.equal(canTransitionOperationsTask('completed', 'in_progress'), false);
});
