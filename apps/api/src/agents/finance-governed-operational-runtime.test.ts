import assert from 'node:assert/strict';
import test from 'node:test';
import type { WorkflowEventRecord } from '../data/operational-repository.js';
import type { FinanceLedgerReconciliationResult } from './finance-ledger-reconciliation.js';
import { createFinanceGovernedOperationalRuntime } from './finance-governed-operational-runtime.js';

function workflowEvent(payload: unknown): WorkflowEventRecord {
  return {
    id: 'event-1',
    clientId: null,
    projectId: null,
    eventType: 'finance_operational_assessment',
    actorType: 'agent',
    actorId: 'finance_agent',
    payload,
    createdAt: new Date().toISOString(),
  };
}

function reconciled(commercialRecordReference: string): FinanceLedgerReconciliationResult {
  return {
    commercialRecordReference,
    reconciled: true,
    entryTypes: [],
    issues: [],
  };
}

test('Finance governed operational runtime persists deterministic assessment evidence as finance_agent', async () => {
  const events: Array<Record<string, unknown>> = [];
  const runtime = createFinanceGovernedOperationalRuntime({
    reconciliationService: {
      async reconcile(reference) {
        return reconciled(reference);
      },
    },
    coordinator: {
      async assess() {
        return {
          commercialRecordReference: 'commercial:1',
          gate: 'PRODUCTION_START',
          state: 'READY_TO_BIND_REQUIREMENT',
          reason: 'Verified payment supports binding.',
          requirementReference: 'deposit:commercial:1',
          paymentEvidenceReference: 'payment-provider:paystack:event-1',
          paymentStatus: 'CONFIRMED',
          authorityState: 'AUTHORIZED',
          advisoryModelAllowed: true,
        };
      },
    },
    eventStore: {
      async createWorkflowEvent(input) {
        events.push(input as unknown as Record<string, unknown>);
        return workflowEvent(input.payload);
      },
    },
  });

  const result = await runtime.assess({
    commercialRecordReference: 'commercial:1',
    gate: 'PRODUCTION_START',
    provider: 'paystack',
    providerPaymentReference: 'transaction:1',
  });

  assert.equal(result.decision.state, 'READY_TO_BIND_REQUIREMENT');
  assert.equal(result.reconciliation.reconciled, true);
  assert.equal(result.auditEventReference, 'workflow-event:event-1');
  assert.equal(events.length, 1);
  assert.equal(events[0]?.eventType, 'finance_operational_assessment');
  assert.equal(events[0]?.actorType, 'agent');
  assert.equal(events[0]?.actorId, 'finance_agent');
  const payload = events[0]?.payload as Record<string, unknown>;
  assert.equal(payload.commercialRecordReference, 'commercial:1');
  assert.equal(payload.gate, 'PRODUCTION_START');
  assert.equal(payload.state, 'READY_TO_BIND_REQUIREMENT');
  assert.equal(payload.paymentEvidenceReference, 'payment-provider:paystack:event-1');
  assert.equal(payload.provider, 'paystack');
  assert.equal(payload.providerPaymentReference, 'transaction:1');
  assert.deepEqual(payload.reconciliation, { reconciled: true, entryTypes: [], issues: [] });
});

test('Finance governed operational runtime records blocked state without inventing payment evidence', async () => {
  let persistedPayload: Record<string, unknown> | undefined;
  const runtime = createFinanceGovernedOperationalRuntime({
    reconciliationService: {
      async reconcile(reference) {
        return reconciled(reference);
      },
    },
    coordinator: {
      async assess() {
        return {
          commercialRecordReference: 'commercial:2',
          gate: 'FINAL_HANDOVER',
          state: 'AWAITING_VERIFIED_PAYMENT',
          reason: 'No authoritative provider payment state has been persisted for this reference.',
          requirementReference: 'final:commercial:2',
          advisoryModelAllowed: true,
        };
      },
    },
    eventStore: {
      async createWorkflowEvent(input) {
        persistedPayload = input.payload as Record<string, unknown>;
        return workflowEvent(input.payload);
      },
    },
  });

  const result = await runtime.assess({
    commercialRecordReference: 'commercial:2',
    gate: 'FINAL_HANDOVER',
    provider: 'paystack',
    providerPaymentReference: 'transaction:missing',
  });

  assert.equal(result.decision.state, 'AWAITING_VERIFIED_PAYMENT');
  assert.equal(persistedPayload?.state, 'AWAITING_VERIFIED_PAYMENT');
  assert.equal('paymentEvidenceReference' in (persistedPayload ?? {}), false);
  assert.equal('clearanceId' in (persistedPayload ?? {}), false);
});

test('Finance governed operational runtime fails closed before coordinator assessment when ledger reconciliation fails', async () => {
  let coordinatorCalls = 0;
  let persistedPayload: Record<string, unknown> | undefined;
  const runtime = createFinanceGovernedOperationalRuntime({
    reconciliationService: {
      async reconcile(reference) {
        return {
          commercialRecordReference: reference,
          reconciled: false,
          entryTypes: ['PAYMENT_REQUIREMENT_CREATED', 'PAYMENT_REQUEST_CREATED'],
          issues: [
            {
              code: 'PAYMENT_REQUEST_REQUIREMENT_REFERENCE_MISMATCH',
              message: 'Payment request authority does not reference the persisted commercial payment requirement authority.',
            },
          ],
        };
      },
    },
    coordinator: {
      async assess() {
        coordinatorCalls += 1;
        throw new Error('Coordinator must not be called for unreconciled Finance history.');
      },
    },
    eventStore: {
      async createWorkflowEvent(input) {
        persistedPayload = input.payload as Record<string, unknown>;
        return workflowEvent(input.payload);
      },
    },
  });

  const result = await runtime.assess({
    commercialRecordReference: ' commercial:3 ',
    gate: 'PRODUCTION_START',
    provider: 'paystack',
    providerPaymentReference: 'transaction:3',
  });

  assert.equal(coordinatorCalls, 0);
  assert.equal(result.decision.state, 'MANUAL_REVIEW');
  assert.match(result.decision.reason, /PAYMENT_REQUEST_REQUIREMENT_REFERENCE_MISMATCH/);
  assert.equal(result.reconciliation.reconciled, false);
  assert.equal(persistedPayload?.state, 'MANUAL_REVIEW');
  assert.deepEqual(persistedPayload?.reconciliation, {
    reconciled: false,
    entryTypes: ['PAYMENT_REQUIREMENT_CREATED', 'PAYMENT_REQUEST_CREATED'],
    issues: [
      {
        code: 'PAYMENT_REQUEST_REQUIREMENT_REFERENCE_MISMATCH',
        message: 'Payment request authority does not reference the persisted commercial payment requirement authority.',
      },
    ],
  });
});
