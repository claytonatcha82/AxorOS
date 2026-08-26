import assert from 'node:assert/strict';
import test from 'node:test';
import { createFinancePaymentEventLedgerWorkflow } from './finance-payment-event-ledger-workflow.js';
import type { PaymentWebhookEnvelope } from '../integrations/payment-webhook-evidence.js';
import type { RecordFinanceLedgerAuthorityInput } from './finance-ledger-recorder.js';
import type { FinancePaymentEventWorkflowResult } from './finance-payment-event-workflow.js';

function envelope(eventType: PaymentWebhookEnvelope['eventType']): PaymentWebhookEnvelope {
  return {
    provider: 'paystack',
    providerEventReference: `event:${eventType}`,
    providerPaymentReference: 'AXOROS-PAYMENT-1',
    eventType,
    commercialRecordReference: 'commercial:event-ledger:1',
    amountMinor: 12500,
    currency: 'ZAR',
    occurredAt: '2026-08-23T15:00:00.000Z',
    signatureVerified: true,
  };
}

function resultFor(event: PaymentWebhookEnvelope): FinancePaymentEventWorkflowResult {
  return {
    evidence: {
      idempotencyKey: `payment-webhook:${event.provider}:${event.providerEventReference}`,
      provider: event.provider,
      providerEventReference: event.providerEventReference,
      providerPaymentReference: event.providerPaymentReference,
      eventType: event.eventType,
      commercialRecordReference: event.commercialRecordReference,
      ...(event.amountMinor !== undefined ? { amountMinor: event.amountMinor } : {}),
      ...(event.currency !== undefined ? { currency: event.currency } : {}),
      occurredAt: event.occurredAt,
      evidenceReference: `payment-provider:${event.provider}:${event.providerEventReference}`,
    },
    webhookPersistence: 'accepted',
    currentStatePersistence: 'accepted',
  };
}

const paymentRequestStore = {
  async getByProviderPaymentReference() {
    return {
      requirementReference: 'requirement:event-ledger:1',
      commercialRecordReference: 'commercial:event-ledger:1',
      provider: 'paystack',
      providerPaymentReference: 'AXOROS-PAYMENT-1',
      authorizationUrl: 'https://checkout.test',
      amountMinor: 12500,
      currency: 'ZAR',
      evidenceReferences: ['payment-request:evidence'],
      createdAt: '2026-08-23T14:59:00.000Z',
    };
  },
};

test('Finance payment event ledger workflow journals provider state from persisted trusted evidence', async () => {
  const recorded: RecordFinanceLedgerAuthorityInput[] = [];
  const paid = envelope('payment_paid');
  const workflow = createFinancePaymentEventLedgerWorkflow({
    eventWorkflow: { async ingest() { return resultFor(paid); } },
    paymentRequestStore,
    ledgerRecorder: { async record(input) { recorded.push(input); } },
  });

  await workflow.ingest(paid);
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0]?.entryType, 'PAYMENT_PROVIDER_STATE_OBSERVED');
  assert.equal(recorded[0]?.authorityType, 'payment_provider_evidence');
  assert.equal(recorded[0]?.authorityReference, 'payment-provider:paystack:event:payment_paid');
  assert.deepEqual(recorded[0]?.evidenceReferences, [
    'payment-provider:paystack:event:payment_paid',
    'requirement:event-ledger:1',
  ]);
  assert.equal(recorded[0]?.amountMinor, 12500);
  assert.equal(recorded[0]?.currency, 'ZAR');
});

test('Finance payment event ledger workflow classifies adverse provider lifecycle evidence separately', async () => {
  const recorded: RecordFinanceLedgerAuthorityInput[] = [];
  const disputed = envelope('payment_disputed');
  const workflow = createFinancePaymentEventLedgerWorkflow({
    eventWorkflow: { async ingest() { return resultFor(disputed); } },
    paymentRequestStore,
    ledgerRecorder: { async record(input) { recorded.push(input); } },
  });

  await workflow.ingest(disputed);
  assert.equal(recorded[0]?.entryType, 'PAYMENT_ADVERSE_EVENT_OBSERVED');
  assert.equal(recorded[0]?.authorityReference, 'payment-provider:paystack:event:payment_disputed');
});
