import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentRuntimeTask } from './agent-runtime-contract.js';
import type { FinanceClearanceDecision } from './finance-clearance-gate.js';
import { applyProductionFinanceGate, assertProductionFinanceGate } from './production-finance-gate.js';

const now = '2026-08-17T21:15:00.000Z';
const task: AgentRuntimeTask = {
  taskId: 'task-production-finance-1', executionId: 'exec-production-finance-1', originAgent: 'operations_agent', destinationAgent: 'production_agent',
  objective: 'Begin governed production work', priority: 'normal', context: {}, knowledgeReferences: [], inputs: {}, expectedOutput: 'Governed production result',
  dependencies: [], risks: [], confidence: 1, approvalRequired: false, status: 'ready', nextAction: 'execute_destination_capability', attempt: 1, maxAttempts: 1,
  correlationId: 'corr-production-finance-1', createdAt: now, updatedAt: now,
};

const cleared: FinanceClearanceDecision = {
  state: 'FINANCE_CLEARED', commercialRecordReference: 'commercial:test:1', reason: 'Provider payment evidence matches the governed commercial record.', evidenceReferences: ['payment-sandbox:sandbox_event:sandbox_paid_001'],
};

const pending: FinanceClearanceDecision = {
  state: 'FINANCE_PENDING', commercialRecordReference: 'commercial:test:1', reason: 'Payment awaiting verification.', evidenceReferences: ['payment-sandbox:sandbox_pending_001:pending'],
};

test('Operations to Production task retains ready state only with FINANCE_CLEARED evidence', () => {
  const governed = applyProductionFinanceGate(task, cleared);
  assert.equal(governed.status, 'ready');
  assert.equal(Reflect.get(governed.context.financeGate as object, 'state'), 'FINANCE_CLEARED');
  assert.doesNotThrow(() => assertProductionFinanceGate(governed));
});

test('Operations to Production task is blocked while Finance is pending', () => {
  const governed = applyProductionFinanceGate(task, pending);
  assert.equal(governed.status, 'blocked');
  assert.equal(governed.nextAction, 'obtain_finance_clearance');
  assert.throws(() => assertProductionFinanceGate(governed), /valid FINANCE_CLEARED evidence is required/);
});

test('Production task cannot bypass gate by omitting Finance context', () => {
  assert.throws(() => assertProductionFinanceGate(task), /FINANCE_CLEARED evidence is missing/);
});

test('non-Production tasks are outside the Production Finance gate', () => {
  const operationsTask = { ...task, destinationAgent: 'operations_agent' as const };
  assert.doesNotThrow(() => assertProductionFinanceGate(operationsTask));
  assert.throws(() => applyProductionFinanceGate(operationsTask, cleared), /destinationAgent production_agent/);
});
