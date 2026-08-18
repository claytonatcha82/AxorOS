import type { FinancePaymentCurrentStatePostgresStore } from '../data/finance-payment-current-state-postgres-store.js';
import { createPaystackWebhookEnvelope } from '../integrations/paystack-webhook-adapter.js';
import type { FinancePaymentEventWorkflowResult } from './finance-payment-event-workflow.js';

export interface PaystackFinancePaymentEventWorkflow {
  ingest(envelope: Parameters<typeof createPaystackWebhookEnvelope> extends never ? never : import('../integrations/payment-webhook-evidence.js').PaymentWebhookEnvelope): Promise<FinancePaymentEventWorkflowResult>;
}

export function createPaystackPaymentWebhookIngress(dependencies: {
  secretKey: string;
  currentStateStore: Pick<FinancePaymentCurrentStatePostgresStore, 'get'>;
  eventWorkflow: PaystackFinancePaymentEventWorkflow;
}) {
  return {
    async ingest(input: { rawBody: string | Buffer; signature: string | undefined }): Promise<FinancePaymentEventWorkflowResult> {
      const envelope = await createPaystackWebhookEnvelope({
        secretKey: dependencies.secretKey,
        async resolveCommercialRecordReference(providerPaymentReference) {
          const current = await dependencies.currentStateStore.get('paystack', providerPaymentReference);
          return current?.commercialRecordReference ?? null;
        },
      }, input);
      return dependencies.eventWorkflow.ingest(envelope);
    },
  };
}
