import assert from 'node:assert/strict';
import test from 'node:test';
import { createFinancePaymentRequestLedgerWorkflow } from './finance-payment-request-ledger-workflow.js';
import type { PersistedFinancePaymentRequest } from '../data/finance-payment-request-postgres-store.js';
import type { RecordFinanceLedgerAuthorityInput } from './finance-ledger-recorder.js';

const requirement = {
  commercialRecordReference: 'commercial:ledger-payment-request:1',
  gate: 'PRODUCTION_START' as const,
  requirementReference: 'requirement:ledger-payment-request:1',
  requirementType: 'DEPOSIT' as const,
  requiredAmountMinor: 12500,
  currency: 'ZAR',
  status: 'ACTIVE' as const,
};

const persisted: PersistedFinancePaymentRequest = {
  requirementReference: requirement.requirementReference,
  commercialRecordReference: requirement.commercialRecordReference,
  provider: 'paystack',
  providerPaymentReference: 'AXOROS-LEDGER-REQUEST-1',
  authorizationUrl: 'https://checkout.paystack.test/ledger-1',
  amountMinor: requirement.requiredAmountMinor,
  currency: requirement.currency,
  evidenceReferences: ['payment-paystack-request:AXOROS-LEDGER-REQUEST-1'],
  createdAt: '2026-08-23T14:00:00.000Z',
};

test('Finance payment request workflow journals only persisted governed checkout authority', async () => {
  const ledgerInputs: RecordFinanceLedgerAuthorityInput[] = [];
  const workflow = createFinancePaymentRequestLedgerWorkflow({
    paymentRequestService: {
      async initialize() {
        return {
          requirement,
          providerPaymentReference: persisted.providerPaymentReference,
          authorizationUrl: persisted.authorizationUrl,
          evidenceReferences: persisted.evidenceReferences,
          replayed: false,
        };
      },
    },
    paymentRequestStore: {
      async get() { return persisted; },
    },
    ledgerRecorder: {
      async record(input) {
        ledgerInputs.push(input);
        return {};
      },
    },
  });

  const result = await workflow.initialize({
    commercialRecordReference: requirement.commercialRecordReference,
    gate: requirement.gate,
    recipientEmail: 'client@example.com',
    executionId: 'exec:ledger-request:1',
    correlationId: 'corr:ledger-request:1',
  });

  assert.equal(result.providerPaymentReference, persisted.providerPaymentReference);
  assert.equal(ledgerInputs.length, 1);
  assert.deepEqual(ledgerInputs[0], {
    entryType: 'PAYMENT_REQUEST_CREATED',
    commercialRecordReference: persisted.commercialRecordReference,
    authorityType: 'finance_payment_request',
    authorityReference: persisted.requirementReference,
    evidenceReferences: [persisted.requirementReference, ...persisted.evidenceReferences],
    amountMinor: persisted.amountMinor,
    currency: persisted.currency,
    occurredAt: persisted.createdAt,
  });
});

test('Finance payment request workflow refuses to journal mismatched persisted authority', async () => {
  const workflow = createFinancePaymentRequestLedgerWorkflow({
    paymentRequestService: {
      async initialize() {
        return {
          requirement,
          providerPaymentReference: persisted.providerPaymentReference,
          authorizationUrl: persisted.authorizationUrl,
          evidenceReferences: persisted.evidenceReferences,
          replayed: false,
        };
      },
    },
    paymentRequestStore: {
      async get() { return { ...persisted, amountMinor: 9999 }; },
    },
    ledgerRecorder: {
      async record() { throw new Error('ledger recorder must not be reached'); },
    },
  });

  await assert.rejects(
    workflow.initialize({
      commercialRecordReference: requirement.commercialRecordReference,
      gate: requirement.gate,
      recipientEmail: 'client@example.com',
      executionId: 'exec:ledger-request:mismatch',
      correlationId: 'corr:ledger-request:mismatch',
    }),
    /does not match governed payment-request authority/,
  );
});
