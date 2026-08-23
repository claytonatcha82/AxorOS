import type { FinanceGovernedPaymentRequestInput, FinanceGovernedPaymentRequestResult } from './finance-governed-payment-request-service.js';
import type { PersistedFinancePaymentRequest } from '../data/finance-payment-request-postgres-store.js';
import type { RecordFinanceLedgerAuthorityInput } from './finance-ledger-recorder.js';

export interface FinancePaymentRequestLedgerWorkflowDependencies {
  paymentRequestService: {
    initialize(input: FinanceGovernedPaymentRequestInput): Promise<FinanceGovernedPaymentRequestResult>;
  };
  paymentRequestStore: {
    get(requirementReference: string): Promise<PersistedFinancePaymentRequest | null>;
  };
  ledgerRecorder: {
    record(input: RecordFinanceLedgerAuthorityInput): Promise<unknown>;
  };
}

export function createFinancePaymentRequestLedgerWorkflow(
  dependencies: FinancePaymentRequestLedgerWorkflowDependencies,
) {
  return {
    async initialize(input: FinanceGovernedPaymentRequestInput): Promise<FinanceGovernedPaymentRequestResult> {
      const result = await dependencies.paymentRequestService.initialize(input);
      const persisted = await dependencies.paymentRequestStore.get(result.requirement.requirementReference);
      if (!persisted) {
        throw new Error(`Persisted Finance payment request ${result.requirement.requirementReference} was not found after initialization.`);
      }
      if (persisted.commercialRecordReference !== result.requirement.commercialRecordReference
        || persisted.amountMinor !== result.requirement.requiredAmountMinor
        || persisted.currency !== result.requirement.currency
        || persisted.providerPaymentReference !== result.providerPaymentReference) {
        throw new Error(`Persisted Finance payment request ${persisted.requirementReference} does not match governed payment-request authority.`);
      }

      await dependencies.ledgerRecorder.record({
        entryType: 'PAYMENT_REQUEST_CREATED',
        commercialRecordReference: persisted.commercialRecordReference,
        authorityType: 'finance_payment_request',
        authorityReference: persisted.requirementReference,
        evidenceReferences: persisted.evidenceReferences,
        amountMinor: persisted.amountMinor,
        currency: persisted.currency,
        occurredAt: persisted.createdAt,
      });

      return result;
    },
  };
}
