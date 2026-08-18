import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentRuntimeTask } from './agent-runtime-contract.js';
import type { PersistedFinanceClearanceDecision } from '../data/finance-clearance-postgres-store.js';
import type { PersistedFinancePaymentCurrentState } from '../data/finance-payment-current-state-postgres-store.js';
import { assertTrustedProductionFinanceGate } from './trusted-production-finance-gate.js';

const cleared: PersistedFinanceClearanceDecision = {
  clearanceId: 'clearance:1', commercialRecordReference: 'commercial:1', providerPaymentReference: 'pay:1',
  state: 'FINANCE_CLEARED', reason: 'Provider evidence matched.', evidenceReferences: ['payment-provider:test:event:1'],
  amountMinor: 125000, currency: 'ZAR', verifiedAt: '2026-08-18T08:40:00.000Z',
};

const current: PersistedFinancePaymentCurrentState = {
  provider: 'test',
  providerPaymentReference: 'pay:1',
  commercialRecordReference: 'commercial:1',
  paymentStatus: 'CONFIRMED',
  authorityState: 'AUTHORIZED',
  reason: 'Verified provider payment confirmation supports Finance authorization.',
  latestEventType: 'payment_paid',
  latestProviderEventReference: 'event:1',
  latestEvidenceReference: 'payment-provider:test:event:1',
  latestOccurredAt: '2026-08-18T08:40:00.000Z',
  amountMinor: 125000,
  currency: 'ZAR',
};

function task(context: Record<string, unknown>): AgentRuntimeTask {
  return {
    taskId: 'task:1', executionId: 'exec:1', originAgent: 'operations_agent', destinationAgent: 'production_agent',
    objective: 'Build the approved client website.', priority: 'normal', context, knowledgeReferences: [],
    inputs: { prompt: 'Build the approved client website.' }, expectedOutput: 'Approved client website production output.',
    dependencies: [], risks: [], confidence: 1, approvalRequired: false, status: 'ready',
    nextAction: 'execute_destination_capability', attempt: 1, maxAttempts: 3, correlationId: 'correlation:1',
    createdAt: '2026-08-18T08:40:00.000Z', updatedAt: '2026-08-18T08:40:00.000Z',
  };
}

const clearanceStore = (decision: PersistedFinanceClearanceDecision | null) => ({ async get() { return decision; } });
const paymentStore = (state: PersistedFinancePaymentCurrentState | null) => ({ async get() { return state; } });
const productionTask = () => task({ financeClearanceId: 'clearance:1', commercialRecordReference: 'commercial:1' });

test('persisted matching FINANCE_CLEARED plus current AUTHORIZED payment state authorizes Production', async () => {
  await assert.doesNotReject(() => assertTrustedProductionFinanceGate(productionTask(), clearanceStore(cleared), paymentStore(current)));
});

test('caller-authored legacy FINANCE_CLEARED object cannot satisfy trusted gate', async () => {
  await assert.rejects(() => assertTrustedProductionFinanceGate(task({ financeGate: { state: 'FINANCE_CLEARED', evidenceReferences: ['fake'] } }), clearanceStore(cleared), paymentStore(current)), /financeClearanceId/);
});

test('missing persisted clearance blocks Production', async () => {
  await assert.rejects(() => assertTrustedProductionFinanceGate(task({ financeClearanceId: 'clearance:missing', commercialRecordReference: 'commercial:1' }), clearanceStore(null), paymentStore(current)), /not found/);
});

test('mismatched commercial record blocks replaying a clearance for another sale', async () => {
  await assert.rejects(() => assertTrustedProductionFinanceGate(task({ financeClearanceId: 'clearance:1', commercialRecordReference: 'commercial:other' }), clearanceStore(cleared), paymentStore(current)), /does not match/);
});

test('persisted pending state cannot authorize Production', async () => {
  await assert.rejects(() => assertTrustedProductionFinanceGate(productionTask(), clearanceStore({ ...cleared, state: 'FINANCE_PENDING' }), paymentStore(current)), /not FINANCE_CLEARED/);
});

test('missing current payment state blocks historical clearance', async () => {
  await assert.rejects(() => assertTrustedProductionFinanceGate(productionTask(), clearanceStore(cleared), paymentStore(null)), /current payment state was not found/);
});

test('refund blocks historical clearance', async () => {
  await assert.rejects(() => assertTrustedProductionFinanceGate(productionTask(), clearanceStore(cleared), paymentStore({ ...current, paymentStatus: 'REFUNDED', authorityState: 'BLOCKED', latestEventType: 'payment_refunded' })), /current payment authority is BLOCKED/);
});

test('dispute requires review and blocks historical clearance', async () => {
  await assert.rejects(() => assertTrustedProductionFinanceGate(productionTask(), clearanceStore(cleared), paymentStore({ ...current, paymentStatus: 'DISPUTED', authorityState: 'MANUAL_REVIEW', latestEventType: 'payment_disputed' })), /current payment authority is MANUAL_REVIEW/);
});

test('chargeback blocks historical clearance', async () => {
  await assert.rejects(() => assertTrustedProductionFinanceGate(productionTask(), clearanceStore(cleared), paymentStore({ ...current, paymentStatus: 'CHARGEBACK', authorityState: 'BLOCKED', latestEventType: 'payment_chargeback' })), /current payment authority is BLOCKED/);
});
