import assert from 'node:assert/strict';
import test from 'node:test';
import { createFinanceGovernedControlCommand } from './finance-governed-control-command.js';

function assessment(state: 'READY_TO_BIND_REQUIREMENT' | 'REQUIREMENT_SATISFIED' | 'PAYMENT_BLOCKED') {
  return {
    decision: {
      commercialRecordReference: 'commercial:finance-control:1',
      gate: 'PRODUCTION_START' as const,
      state,
      reason: state,
      advisoryModelAllowed: true,
    },
    auditEventReference: `workflow-event:${state}`,
    reconciliation: {
      commercialRecordReference: 'commercial:finance-control:1',
      reconciled: true,
      entryTypes: [],
      issues: [],
    },
  };
}

test('Finance control binding validates trusted evidence identity and generates authority identifiers internally', async () => {
  const seenBindingInputs: Record<string, unknown>[] = [];
  let assessments = 0;
  const command = createFinanceGovernedControlCommand({
    operationalRuntime: {
      async assess() {
        assessments += 1;
        return assessments === 1 ? assessment('READY_TO_BIND_REQUIREMENT') : assessment('REQUIREMENT_SATISFIED');
      },
    },
    paymentWebhookEvidenceStore: {
      async get() {
        return {
          idempotencyKey: 'payment-webhook:paystack:event:1',
          provider: 'paystack',
          providerEventReference: 'event:1',
          providerPaymentReference: 'pay:1',
          eventType: 'payment_paid',
          commercialRecordReference: 'commercial:finance-control:1',
          amountMinor: 10000,
          currency: 'ZAR',
          occurredAt: '2026-08-23T00:00:00.000Z',
          evidenceReference: 'payment-provider:paystack:event:1',
        };
      },
    },
    bindingService: {
      async bind(input) {
        seenBindingInputs.push(input as unknown as Record<string, unknown>);
        return {
          before: { state: 'READY_TO_BIND_REQUIREMENT' },
          binding: {
            clearance: { decision: { clearanceId: input.clearanceId, state: 'FINANCE_CLEARED' } },
            satisfactionPersistence: 'accepted' as const,
          },
          after: { state: 'REQUIREMENT_SATISFIED' },
        };
      },
    },
  });

  const result = await command.bind({
    commercialRecordReference: 'commercial:finance-control:1',
    gate: 'PRODUCTION_START',
    provider: 'paystack',
    providerPaymentReference: 'pay:1',
    trustedPaymentWebhookIdempotencyKey: 'payment-webhook:paystack:event:1',
  });

  assert.equal(result.after.state, 'REQUIREMENT_SATISFIED');
  assert.equal(seenBindingInputs.length, 1);
  const input = seenBindingInputs[0]!;
  assert.match(String(input.clearanceId), /^finance-clearance:control:/);
  assert.match(String(input.executionId), /^exec:finance-control:/);
  assert.match(String(input.correlationId), /^corr:finance-control:/);
});

test('Finance control binding rejects mismatched trusted evidence before any authority mutation', async () => {
  let bindingCalls = 0;
  let assessmentCalls = 0;
  const command = createFinanceGovernedControlCommand({
    operationalRuntime: {
      async assess() {
        assessmentCalls += 1;
        return assessment('READY_TO_BIND_REQUIREMENT');
      },
    },
    paymentWebhookEvidenceStore: {
      async get() {
        return {
          idempotencyKey: 'payment-webhook:paystack:event:other',
          provider: 'paystack',
          providerEventReference: 'event:other',
          providerPaymentReference: 'pay:other',
          eventType: 'payment_paid',
          commercialRecordReference: 'commercial:finance-control:1',
          amountMinor: 10000,
          currency: 'ZAR',
          occurredAt: '2026-08-23T00:00:00.000Z',
          evidenceReference: 'payment-provider:paystack:event:other',
        };
      },
    },
    bindingService: {
      async bind() {
        bindingCalls += 1;
        throw new Error('must not be called');
      },
    },
  });

  await assert.rejects(
    () => command.bind({
      commercialRecordReference: 'commercial:finance-control:1',
      gate: 'PRODUCTION_START',
      provider: 'paystack',
      providerPaymentReference: 'pay:1',
      trustedPaymentWebhookIdempotencyKey: 'payment-webhook:paystack:event:other',
    }),
    /evidence reference does not match/,
  );
  assert.equal(bindingCalls, 0);
  assert.equal(assessmentCalls, 0);
});
