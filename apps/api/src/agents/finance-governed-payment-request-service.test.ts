import assert from 'node:assert/strict';
import test from 'node:test';
import { createFinanceGovernedPaymentRequestService } from './finance-governed-payment-request-service.js';
import type { PersistedCommercialPaymentRequirement } from '../data/commercial-payment-requirement-postgres-store.js';
import type { PersistedFinancePaymentRequest } from '../data/finance-payment-request-postgres-store.js';

const activeRequirement: PersistedCommercialPaymentRequirement = {
  commercialRecordReference: 'commercial:test:1',
  gate: 'PRODUCTION_START',
  requirementReference: 'requirement:test:1',
  requirementType: 'DEPOSIT',
  requiredAmountMinor: 12500,
  currency: 'ZAR',
  status: 'ACTIVE',
};

function memoryPaymentRequestStore() {
  const records = new Map<string, PersistedFinancePaymentRequest>();
  return {
    async get(requirementReference: string) {
      return records.get(requirementReference) ?? null;
    },
    async save(record: PersistedFinancePaymentRequest) {
      const existing = records.get(record.requirementReference);
      if (existing) return 'duplicate' as const;
      records.set(record.requirementReference, record);
      return 'accepted' as const;
    },
  };
}

function service(requirement: PersistedCommercialPaymentRequirement | null) {
  let capturedRequest: Record<string, unknown> | undefined;
  let providerCalls = 0;
  const paymentRequestStore = memoryPaymentRequestStore();
  const instance = createFinanceGovernedPaymentRequestService({
    requirementStore: {
      async get() {
        return requirement;
      },
    },
    paymentRequestStore,
    integrations: {
      async execute(request) {
        providerCalls += 1;
        capturedRequest = request as unknown as Record<string, unknown>;
        const input = request.input as {
          commercialRecordReference: string;
          requirementReference: string;
          providerPaymentReference: string;
        };
        return {
          integrationId: 'payment.paystack.request',
          operation: request.operation,
          provider: 'paystack',
          mode: request.mode,
          status: 'succeeded' as const,
          output: {
            commercialRecordReference: input.commercialRecordReference,
            requirementReference: input.requirementReference,
            providerPaymentReference: input.providerPaymentReference,
            authorizationUrl: 'https://checkout.paystack.test/abc',
            accessCode: 'access_test_123',
          },
          externalReference: input.providerPaymentReference,
          evidenceReferences: [`payment-paystack-request:${input.providerPaymentReference}`],
          retryable: false,
        };
      },
    },
  });
  return { instance, captured: () => capturedRequest, providerCalls: () => providerCalls, paymentRequestStore };
}

test('Finance payment request derives authority from persisted requirement and persists provider checkout authority', async () => {
  const { instance, captured, paymentRequestStore } = service(activeRequirement);
  const result = await instance.initialize({
    commercialRecordReference: activeRequirement.commercialRecordReference,
    gate: activeRequirement.gate,
    recipientEmail: 'client@example.com',
    executionId: 'exec:test:1',
    correlationId: 'corr:test:1',
  });

  const request = captured();
  assert.ok(request);
  const input = request.input as Record<string, unknown>;
  assert.equal(request.requestedBy, 'finance_agent');
  assert.equal(request.operation, 'initialize_payment_request');
  assert.equal(input.commercialRecordReference, activeRequirement.commercialRecordReference);
  assert.equal(input.requirementReference, activeRequirement.requirementReference);
  assert.equal(input.amountMinor, 12500);
  assert.equal(input.currency, 'ZAR');
  assert.equal(input.recipientEmail, 'client@example.com');
  assert.equal(typeof input.providerPaymentReference, 'string');
  assert.equal(String(input.providerPaymentReference).startsWith('AXOROS-'), true);
  assert.equal(result.providerPaymentReference, input.providerPaymentReference);
  assert.equal(result.requirement, activeRequirement);
  assert.equal(result.replayed, false);

  const persisted = await paymentRequestStore.get(activeRequirement.requirementReference);
  assert.ok(persisted);
  assert.equal(persisted.amountMinor, activeRequirement.requiredAmountMinor);
  assert.equal(persisted.currency, activeRequirement.currency);
  assert.equal(persisted.authorizationUrl, result.authorizationUrl);
});

test('Finance payment request replays persisted checkout authority without calling provider twice', async () => {
  const { instance, providerCalls } = service(activeRequirement);
  const input = {
    commercialRecordReference: activeRequirement.commercialRecordReference,
    gate: activeRequirement.gate,
    recipientEmail: 'client@example.com',
    executionId: 'exec:test:replay',
    correlationId: 'corr:test:replay',
  } as const;
  const first = await instance.initialize(input);
  const second = await instance.initialize(input);
  assert.equal(first.replayed, false);
  assert.equal(second.replayed, true);
  assert.equal(second.providerPaymentReference, first.providerPaymentReference);
  assert.equal(second.authorizationUrl, first.authorizationUrl);
  assert.equal(providerCalls(), 1);
});

test('Finance payment request fails closed when no persisted requirement exists', async () => {
  const { instance } = service(null);
  await assert.rejects(
    instance.initialize({
      commercialRecordReference: 'commercial:missing',
      gate: 'PRODUCTION_START',
      recipientEmail: 'client@example.com',
      executionId: 'exec:missing',
      correlationId: 'corr:missing',
    }),
    /No persisted commercial payment requirement exists/,
  );
});

test('Finance payment request fails closed for non-active persisted requirement', async () => {
  const { instance } = service({ ...activeRequirement, status: 'SATISFIED' });
  await assert.rejects(
    instance.initialize({
      commercialRecordReference: activeRequirement.commercialRecordReference,
      gate: activeRequirement.gate,
      recipientEmail: 'client@example.com',
      executionId: 'exec:satisfied',
      correlationId: 'corr:satisfied',
    }),
    /is not ACTIVE/,
  );
});

test('Finance payment request rejects provider response bound to a different commercial record', async () => {
  const instance = createFinanceGovernedPaymentRequestService({
    requirementStore: { async get() { return activeRequirement; } },
    paymentRequestStore: memoryPaymentRequestStore(),
    integrations: {
      async execute(request) {
        const input = request.input as { requirementReference: string; providerPaymentReference: string };
        return {
          integrationId: 'payment.paystack.request',
          operation: request.operation,
          provider: 'paystack',
          mode: request.mode,
          status: 'succeeded' as const,
          output: {
            commercialRecordReference: 'commercial:other',
            requirementReference: input.requirementReference,
            providerPaymentReference: input.providerPaymentReference,
            authorizationUrl: 'https://checkout.paystack.test/abc',
            accessCode: 'access_test_123',
          },
          evidenceReferences: ['payment-paystack-request:test'],
          retryable: false,
        };
      },
    },
  });

  await assert.rejects(
    instance.initialize({
      commercialRecordReference: activeRequirement.commercialRecordReference,
      gate: activeRequirement.gate,
      recipientEmail: 'client@example.com',
      executionId: 'exec:mismatch',
      correlationId: 'corr:mismatch',
    }),
    /commercial record does not match/,
  );
});
