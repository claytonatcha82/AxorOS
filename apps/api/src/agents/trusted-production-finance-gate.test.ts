import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentRuntimeTask } from './agent-runtime-contract.js';
import type { PersistedFinanceClearanceDecision } from '../data/finance-clearance-postgres-store.js';
import { assertTrustedProductionFinanceGate } from './trusted-production-finance-gate.js';

const cleared: PersistedFinanceClearanceDecision = {
  clearanceId: 'clearance:1', commercialRecordReference: 'commercial:1', providerPaymentReference: 'pay:1',
  state: 'FINANCE_CLEARED', reason: 'Provider evidence matched.', evidenceReferences: ['provider:event:1'],
  amountMinor: 125000, currency: 'ZAR', verifiedAt: '2026-08-18T08:40:00.000Z',
};

function task(context: Record<string, unknown>): AgentRuntimeTask {
  return {
    executionId: 'exec:1', taskId: 'task:1', sourceAgent: 'operations_agent', destinationAgent: 'production_agent',
    capabilityId: 'production.technical_assistance', status: 'ready', priority: 'normal', risk: 'low', approvalRequired: false,
    inputs: { prompt: 'Build the approved client website.' }, context, knowledgeReferences: [], retryCount: 0,
    createdAt: '2026-08-18T08:40:00.000Z', updatedAt: '2026-08-18T08:40:00.000Z',
  };
}

const store = (decision: PersistedFinanceClearanceDecision | null) => ({ async get() { return decision; } });

test('persisted matching FINANCE_CLEARED record authorizes Production', async () => {
  await assert.doesNotReject(() => assertTrustedProductionFinanceGate(task({ financeClearanceId: 'clearance:1', commercialRecordReference: 'commercial:1' }), store(cleared)));
});

test('caller-authored legacy FINANCE_CLEARED object cannot satisfy trusted gate', async () => {
  await assert.rejects(() => assertTrustedProductionFinanceGate(task({ financeGate: { state: 'FINANCE_CLEARED', evidenceReferences: ['fake'] } }), store(cleared)), /financeClearanceId/);
});

test('missing persisted clearance blocks Production', async () => {
  await assert.rejects(() => assertTrustedProductionFinanceGate(task({ financeClearanceId: 'clearance:missing', commercialRecordReference: 'commercial:1' }), store(null)), /not found/);
});

test('mismatched commercial record blocks replaying a clearance for another sale', async () => {
  await assert.rejects(() => assertTrustedProductionFinanceGate(task({ financeClearanceId: 'clearance:1', commercialRecordReference: 'commercial:other' }), store(cleared)), /does not match/);
});

test('persisted pending state cannot authorize Production', async () => {
  await assert.rejects(() => assertTrustedProductionFinanceGate(task({ financeClearanceId: 'clearance:1', commercialRecordReference: 'commercial:1' }), store({ ...cleared, state: 'FINANCE_PENDING' })), /not FINANCE_CLEARED/);
});
