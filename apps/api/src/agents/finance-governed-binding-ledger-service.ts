import type { CommercialPaymentRequirementPostgresStore } from '../data/commercial-payment-requirement-postgres-store.js';
import type { CommercialPaymentSatisfactionPostgresStore } from '../data/commercial-payment-satisfaction-postgres-store.js';
import type { FinanceClearancePostgresStore } from '../data/finance-clearance-postgres-store.js';
import type { FinanceGovernedBindingInput } from './finance-governed-binding-service.js';
import type { RecordFinanceLedgerAuthorityInput } from './finance-ledger-recorder.js';

export interface FinanceGovernedBindingLedgerServiceDependencies<TResult> {
  bindingService: {
    bind(input: FinanceGovernedBindingInput): Promise<TResult>;
  };
  requirementStore: Pick<CommercialPaymentRequirementPostgresStore, 'get'>;
  clearanceStore: Pick<FinanceClearancePostgresStore, 'get'>;
  satisfactionStore: Pick<CommercialPaymentSatisfactionPostgresStore, 'get'>;
  ledgerRecorder: {
    record(input: RecordFinanceLedgerAuthorityInput): Promise<unknown>;
  };
}

export function createFinanceGovernedBindingLedgerService<TResult>(
  dependencies: FinanceGovernedBindingLedgerServiceDependencies<TResult>,
) {
  return {
    async bind(input: FinanceGovernedBindingInput): Promise<TResult> {
      const result = await dependencies.bindingService.bind(input);

      const requirement = await dependencies.requirementStore.get(input.commercialRecordReference, input.gate);
      if (!requirement) {
        throw new Error(`Persisted commercial payment requirement was not found after governed binding for ${input.commercialRecordReference}:${input.gate}.`);
      }

      const clearance = await dependencies.clearanceStore.get(input.clearanceId);
      if (!clearance) {
        throw new Error(`Persisted Finance clearance ${input.clearanceId} was not found after governed binding.`);
      }
      if (clearance.state !== 'FINANCE_CLEARED'
        || clearance.commercialRecordReference !== requirement.commercialRecordReference
        || clearance.amountMinor !== requirement.requiredAmountMinor
        || clearance.currency !== requirement.currency) {
        throw new Error(`Persisted Finance clearance ${input.clearanceId} does not match governed commercial authority.`);
      }

      const satisfaction = await dependencies.satisfactionStore.get(requirement.requirementReference);
      if (!satisfaction) {
        throw new Error(`Persisted commercial payment satisfaction ${requirement.requirementReference} was not found after governed binding.`);
      }
      if (satisfaction.clearanceId !== clearance.clearanceId
        || satisfaction.commercialRecordReference !== requirement.commercialRecordReference
        || satisfaction.gate !== requirement.gate) {
        throw new Error(`Persisted commercial payment satisfaction ${requirement.requirementReference} does not match governed Finance clearance.`);
      }

      await dependencies.ledgerRecorder.record({
        entryType: 'FINANCE_CLEARANCE_CREATED',
        commercialRecordReference: clearance.commercialRecordReference,
        authorityType: 'finance_clearance',
        authorityReference: clearance.clearanceId,
        evidenceReferences: clearance.evidenceReferences,
        amountMinor: clearance.amountMinor,
        currency: clearance.currency,
        occurredAt: clearance.verifiedAt,
      });

      await dependencies.ledgerRecorder.record({
        entryType: 'PAYMENT_REQUIREMENT_SATISFIED',
        commercialRecordReference: satisfaction.commercialRecordReference,
        authorityType: 'commercial_payment_satisfaction',
        authorityReference: satisfaction.requirementReference,
        evidenceReferences: clearance.evidenceReferences,
        amountMinor: requirement.requiredAmountMinor,
        currency: requirement.currency,
        occurredAt: satisfaction.satisfiedAt,
      });

      return result;
    },
  };
}
