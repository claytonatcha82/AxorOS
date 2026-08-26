import type { PersistedFinancePaymentRequest } from '../data/finance-payment-request-postgres-store.js';
import type { PaymentWebhookEnvelope } from '../integrations/payment-webhook-evidence.js';
import type { FinancePaymentEventWorkflowResult } from './finance-payment-event-workflow.js';
import type { RecordFinanceLedgerAuthorityInput } from './finance-ledger-recorder.js';

export interface FinancePaymentEventLedgerWorkflowDependencies {
  eventWorkflow: {
    ingest(envelope: PaymentWebhookEnvelope): Promise<FinancePaymentEventWorkflowResult>;
  };
  paymentRequestStore: {
    getByProviderPaymentReference(
      provider: string,
      providerPaymentReference: string,
    ): Promise<PersistedFinancePaymentRequest | null>;
  };
  ledgerRecorder: {
    record(input: RecordFinanceLedgerAuthorityInput): Promise<unknown>;
  };
}

function isAdverseEvent(eventType: FinancePaymentEventWorkflowResult['evidence']['eventType']): boolean {
  return eventType === 'payment_failed'
    || eventType === 'payment_refunded'
    || eventType === 'payment_reversed'
    || eventType === 'payment_disputed'
    || eventType === 'payment_chargeback';
}

export function createFinancePaymentEventLedgerWorkflow(
  dependencies: FinancePaymentEventLedgerWorkflowDependencies,
) {
  return {
    async ingest(envelope: PaymentWebhookEnvelope): Promise<FinancePaymentEventWorkflowResult> {
      const result = await dependencies.eventWorkflow.ingest(envelope);
      const evidence = result.evidence;
      const paymentRequest = await dependencies.paymentRequestStore.getByProviderPaymentReference(
        evidence.provider,
        evidence.providerPaymentReference,
      );

      await dependencies.ledgerRecorder.record({
        entryType: isAdverseEvent(evidence.eventType)
          ? 'PAYMENT_ADVERSE_EVENT_OBSERVED'
          : 'PAYMENT_PROVIDER_STATE_OBSERVED',
        commercialRecordReference: evidence.commercialRecordReference,
        authorityType: 'payment_provider_evidence',
        authorityReference: evidence.evidenceReference,
        evidenceReferences: [
          evidence.evidenceReference,
          ...(paymentRequest ? [paymentRequest.requirementReference] : []),
        ],
        occurredAt: evidence.occurredAt,
        ...(evidence.amountMinor !== undefined ? { amountMinor: evidence.amountMinor } : {}),
        ...(evidence.currency !== undefined ? { currency: evidence.currency } : {}),
      });

      return result;
    },
  };
}
