import type { PaymentWebhookPostgresStore } from '../data/payment-webhook-postgres-store.js';
import type { FinancePaymentCurrentStatePostgresStore, FinancePaymentCurrentStateApplyResult } from '../data/finance-payment-current-state-postgres-store.js';
import type { IntegrationMode } from '../integrations/integration-contract.js';
import { createPaymentWebhookEvidence, type PaymentWebhookEnvelope, type PaymentWebhookEvidence } from '../integrations/payment-webhook-evidence.js';
import type { VerifyFinancePaymentResult } from './finance-payment-clearance-workflow.js';

export interface FinancePaymentEventClearanceWorkflow {
  verifyAndPersist(input: {
    clearanceId: string;
    executionId: string;
    correlationId: string;
    paymentIntegrationId: string;
    mode: IntegrationMode;
    expected: {
      providerPaymentReference: string;
      expectedAmountMinor: number;
      currency: string;
      commercialRecordReference: string;
    };
    trustedPaymentWebhookIdempotencyKey?: string;
  }): Promise<VerifyFinancePaymentResult>;
}

export interface FinancePaymentEventWorkflowResult {
  evidence: PaymentWebhookEvidence;
  webhookPersistence: 'accepted' | 'duplicate';
  currentStatePersistence: FinancePaymentCurrentStateApplyResult | 'not_applied';
  clearance?: VerifyFinancePaymentResult;
}

function eventScopedId(prefix: string, evidence: PaymentWebhookEvidence): string {
  return `${prefix}:${evidence.provider}:${evidence.providerEventReference}`;
}

export function createFinancePaymentEventWorkflow(dependencies: {
  webhookStore: Pick<PaymentWebhookPostgresStore, 'save' | 'get'>;
  currentStateStore: Pick<FinancePaymentCurrentStatePostgresStore, 'apply'>;
  clearanceWorkflow: FinancePaymentEventClearanceWorkflow;
  paymentIntegrationId: string;
  mode: IntegrationMode;
}) {
  const paymentIntegrationId = dependencies.paymentIntegrationId.trim();
  if (!paymentIntegrationId) throw new Error('paymentIntegrationId is required.');

  return {
    async ingest(envelope: PaymentWebhookEnvelope): Promise<FinancePaymentEventWorkflowResult> {
      const candidate = createPaymentWebhookEvidence(envelope);
      const webhookPersistence = await dependencies.webhookStore.save(candidate);
      const evidence = await dependencies.webhookStore.get(candidate.idempotencyKey);
      if (!evidence) {
        throw new Error('Persisted trusted payment webhook evidence could not be reloaded after ingestion.');
      }

      if (evidence.eventType !== 'payment_paid') {
        const currentStatePersistence = await dependencies.currentStateStore.apply(evidence);
        return { evidence, webhookPersistence, currentStatePersistence };
      }

      if (evidence.amountMinor === undefined || evidence.currency === undefined) {
        throw new Error('Verified paid webhook evidence requires amount and currency before Finance clearance can be evaluated.');
      }

      const clearance = await dependencies.clearanceWorkflow.verifyAndPersist({
        clearanceId: eventScopedId('finance-clearance', evidence),
        executionId: eventScopedId('finance-payment-event', evidence),
        correlationId: eventScopedId('finance-payment-correlation', evidence),
        paymentIntegrationId,
        mode: dependencies.mode,
        expected: {
          providerPaymentReference: evidence.providerPaymentReference,
          expectedAmountMinor: evidence.amountMinor,
          currency: evidence.currency,
          commercialRecordReference: evidence.commercialRecordReference,
        },
        trustedPaymentWebhookIdempotencyKey: evidence.idempotencyKey,
      });

      if (clearance.decision.state !== 'FINANCE_CLEARED') {
        return {
          evidence,
          webhookPersistence,
          currentStatePersistence: 'not_applied',
          clearance,
        };
      }

      const currentStatePersistence = await dependencies.currentStateStore.apply(evidence);
      return { evidence, webhookPersistence, currentStatePersistence, clearance };
    },
  };
}
