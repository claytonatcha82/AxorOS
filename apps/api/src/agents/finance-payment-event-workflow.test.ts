import assert from 'node:assert/strict';
import test from 'node:test';
import type { PersistedFinanceClearanceDecision } from '../data/finance-clearance-postgres-store.js';
import type { PaymentWebhookEvidence, PaymentWebhookEnvelope } from '../integrations/payment-webhook-evidence.js';
import { DeterministicPaymentIntegration } from '../integrations/deterministic-payment-integration.js';
import { IntegrationRegistry } from '../integrations/integration-registry.js';
import { createFinancePaymentClearanceWorkflow } from './finance-payment-clearance-workflow.js';
import { createFinancePaymentEventWorkflow } from './finance-payment-event-workflow.js';

function paidEnvelope(providerPaymentReference = 'sandbox_paid_event_workflow_001'): PaymentWebhookEnvelope {
  return {
    provider: 'deterministic-payment-sandbox',
    providerEventReference: 'evt_event_workflow_001',
    providerPaymentReference,
    eventType: 'payment_paid',
    commercialRecordReference: 'commercial:event-workflow:1',
    amountMinor: 125000,
    currency: 'ZAR',
    occurredAt: '2026-08-18T18:05:00.000Z',
    signatureVerified: true,
  };
}

function createHarness() {
  const evidenceByKey = new Map<string, PaymentWebhookEvidence>();
  const decisions: PersistedFinanceClearanceDecision[] = [];
  const appliedStates: PaymentWebhookEvidence[] = [];

  const webhookStore = {
    async save(evidence: PaymentWebhookEvidence) {
      const existing = evidenceByKey.get(evidence.idempotencyKey);
      if (existing) return 'duplicate' as const;
      evidenceByKey.set(evidence.idempotencyKey, evidence);
      return 'accepted' as const;
    },
    async get(idempotencyKey: string) {
      return evidenceByKey.get(idempotencyKey) ?? null;
    },
  };
  const currentStateStore = {
    async apply(evidence: PaymentWebhookEvidence) {
      appliedStates.push(evidence);
      return 'accepted' as const;
    },
  };
  const clearanceStore = {
    async save(decision: PersistedFinanceClearanceDecision) {
      decisions.push(decision);
      return 'accepted' as const;
    },
  };
  const integrations = new IntegrationRegistry();
  integrations.register(new DeterministicPaymentIntegration());
  const clearanceWorkflow = createFinancePaymentClearanceWorkflow({
    integrations,
    clearanceStore,
    paymentWebhookEvidenceStore: webhookStore,
  });
  const eventWorkflow = createFinancePaymentEventWorkflow({
    webhookStore,
    currentStateStore,
    clearanceWorkflow,
    paymentIntegrationId: 'payment.sandbox',
    mode: 'sandbox',
  });

  return { eventWorkflow, decisions, appliedStates, evidenceByKey };
}

test('trusted paid webhook is persisted, independently verified, bound into clearance evidence, then applied as current state', async () => {
  const { eventWorkflow, decisions, appliedStates, evidenceByKey } = createHarness();
  const result = await eventWorkflow.ingest(paidEnvelope());

  assert.equal(result.webhookPersistence, 'accepted');
  assert.equal(result.clearance?.decision.state, 'FINANCE_CLEARED');
  assert.equal(result.currentStatePersistence, 'accepted');
  assert.equal(evidenceByKey.size, 1);
  assert.equal(decisions.length, 1);
  assert.equal(appliedStates.length, 1);
  assert.ok(result.clearance?.decision.evidenceReferences.includes('payment-provider:deterministic-payment-sandbox:evt_event_workflow_001'));
  assert.ok(result.clearance?.decision.evidenceReferences.some((reference) => reference.startsWith('payment-sandbox:')));
  assert.equal(result.clearance?.decision.providerPaymentReference, 'sandbox_paid_event_workflow_001');
});

test('paid webhook that independent verification cannot confirm never becomes authoritative current paid state', async () => {
  const { eventWorkflow, decisions, appliedStates } = createHarness();
  const result = await eventWorkflow.ingest(paidEnvelope('sandbox_pending_event_workflow_001'));

  assert.equal(result.clearance?.decision.state, 'FINANCE_PENDING');
  assert.equal(result.currentStatePersistence, 'not_applied');
  assert.equal(decisions.length, 1);
  assert.equal(appliedStates.length, 0);
});

test('trusted adverse payment event revokes current state without creating a new Finance clearance', async () => {
  const { eventWorkflow, decisions, appliedStates } = createHarness();
  const envelope: PaymentWebhookEnvelope = {
    ...paidEnvelope(),
    providerEventReference: 'evt_event_workflow_refund_001',
    eventType: 'payment_refunded',
    occurredAt: '2026-08-18T18:06:00.000Z',
  };

  const result = await eventWorkflow.ingest(envelope);

  assert.equal(result.webhookPersistence, 'accepted');
  assert.equal(result.currentStatePersistence, 'accepted');
  assert.equal(result.clearance, undefined);
  assert.equal(decisions.length, 0);
  assert.equal(appliedStates.length, 1);
  assert.equal(appliedStates[0]?.eventType, 'payment_refunded');
});

test('unsigned webhook is rejected before durable ingestion or Finance processing', async () => {
  const { eventWorkflow, decisions, appliedStates, evidenceByKey } = createHarness();
  await assert.rejects(
    () => eventWorkflow.ingest({ ...paidEnvelope(), signatureVerified: false }),
    /signature must be verified/,
  );
  assert.equal(evidenceByKey.size, 0);
  assert.equal(decisions.length, 0);
  assert.equal(appliedStates.length, 0);
});
