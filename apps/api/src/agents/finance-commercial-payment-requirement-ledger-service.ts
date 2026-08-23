import type {
  CommercialPaymentRequirementPostgresStore,
  PersistedCommercialPaymentRequirement,
} from '../data/commercial-payment-requirement-postgres-store.js';
import type { RecordFinanceLedgerAuthorityInput } from './finance-ledger-recorder.js';

export interface FinanceCommercialPaymentRequirementLedgerServiceDependencies {
  requirementStore: Pick<CommercialPaymentRequirementPostgresStore, 'save' | 'get'>;
  ledgerRecorder: {
    record(input: RecordFinanceLedgerAuthorityInput): Promise<unknown>;
  };
}

export function createFinanceCommercialPaymentRequirementLedgerService(
  dependencies: FinanceCommercialPaymentRequirementLedgerServiceDependencies,
) {
  return {
    async save(requirement: PersistedCommercialPaymentRequirement): Promise<'accepted' | 'duplicate'> {
      const persistence = await dependencies.requirementStore.save(requirement);
      const persisted = await dependencies.requirementStore.get(
        requirement.commercialRecordReference,
        requirement.gate,
      );
      if (!persisted) {
        throw new Error('Persisted commercial payment requirement could not be reloaded after save.');
      }
      if (persisted.requirementReference !== requirement.requirementReference
        || persisted.requiredAmountMinor !== requirement.requiredAmountMinor
        || persisted.currency !== requirement.currency
        || persisted.requirementType !== requirement.requirementType
        || persisted.status !== requirement.status) {
        throw new Error('Persisted commercial payment requirement does not match submitted Finance authority.');
      }

      await dependencies.ledgerRecorder.record({
        entryType: 'PAYMENT_REQUIREMENT_CREATED',
        commercialRecordReference: persisted.commercialRecordReference,
        authorityType: 'commercial_payment_requirement',
        authorityReference: persisted.requirementReference,
        evidenceReferences: [`commercial-payment-requirement:${persisted.requirementReference}`],
        amountMinor: persisted.requiredAmountMinor,
        currency: persisted.currency,
        occurredAt: new Date(0).toISOString(),
      });

      return persistence;
    },
  };
}
