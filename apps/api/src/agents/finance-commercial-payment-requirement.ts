import type { CommercialPaymentRequirementPostgresStore, CommercialPaymentGate } from '../data/commercial-payment-requirement-postgres-store.js';
import type { CommercialPaymentSatisfactionPostgresStore, PersistedCommercialPaymentSatisfaction } from '../data/commercial-payment-satisfaction-postgres-store.js';
import type { FinanceClearancePostgresStore } from '../data/finance-clearance-postgres-store.js';

export async function satisfyCommercialPaymentRequirement(dependencies: {
  requirementStore: Pick<CommercialPaymentRequirementPostgresStore, 'get'>;
  satisfactionStore: Pick<CommercialPaymentSatisfactionPostgresStore, 'save'>;
  clearanceStore: Pick<FinanceClearancePostgresStore, 'get'>;
}, input: {
  commercialRecordReference: string;
  gate: CommercialPaymentGate;
  clearanceId: string;
}): Promise<{ satisfaction: PersistedCommercialPaymentSatisfaction; persistence: 'accepted' | 'duplicate' }> {
  const requirement = await dependencies.requirementStore.get(input.commercialRecordReference, input.gate);
  if (!requirement) throw new Error(`Commercial payment requirement not found for ${input.commercialRecordReference}:${input.gate}.`);
  if (requirement.status !== 'ACTIVE' && requirement.status !== 'SATISFIED') {
    throw new Error(`Commercial payment requirement ${requirement.requirementReference} is ${requirement.status}.`);
  }

  const clearance = await dependencies.clearanceStore.get(input.clearanceId);
  if (!clearance) throw new Error(`Finance clearance ${input.clearanceId} was not found.`);
  if (clearance.state !== 'FINANCE_CLEARED') throw new Error(`Finance clearance ${input.clearanceId} is not FINANCE_CLEARED.`);
  if (clearance.commercialRecordReference !== requirement.commercialRecordReference) {
    throw new Error('Finance clearance does not match the commercial payment requirement record.');
  }
  if (clearance.currency !== requirement.currency) {
    throw new Error('Finance clearance currency does not satisfy the commercial payment requirement.');
  }
  if (clearance.amountMinor < requirement.requiredAmountMinor) {
    throw new Error('Finance clearance amount does not satisfy the commercial payment requirement.');
  }

  const satisfaction: PersistedCommercialPaymentSatisfaction = {
    requirementReference: requirement.requirementReference,
    clearanceId: clearance.clearanceId,
    commercialRecordReference: requirement.commercialRecordReference,
    gate: requirement.gate,
    satisfiedAt: clearance.verifiedAt,
  };
  const persistence = await dependencies.satisfactionStore.save(satisfaction);
  return { satisfaction, persistence };
}

export async function assertCommercialPaymentGateSatisfied(dependencies: {
  requirementStore: Pick<CommercialPaymentRequirementPostgresStore, 'get'>;
  satisfactionStore: Pick<CommercialPaymentSatisfactionPostgresStore, 'get'>;
}, input: {
  commercialRecordReference: string;
  gate: CommercialPaymentGate;
  clearanceId: string;
}): Promise<void> {
  const requirement = await dependencies.requirementStore.get(input.commercialRecordReference, input.gate);
  if (!requirement) throw new Error(`No persisted ${input.gate} payment requirement was found for the commercial record.`);
  if (requirement.status !== 'ACTIVE' && requirement.status !== 'SATISFIED') {
    throw new Error(`${input.gate} payment requirement is ${requirement.status}.`);
  }

  const satisfaction = await dependencies.satisfactionStore.get(requirement.requirementReference);
  if (!satisfaction) throw new Error(`${input.gate} payment requirement has not been satisfied by an authoritative Finance clearance.`);
  if (satisfaction.clearanceId !== input.clearanceId) {
    throw new Error(`${input.gate} payment requirement is linked to a different Finance clearance.`);
  }
  if (satisfaction.commercialRecordReference !== input.commercialRecordReference || satisfaction.gate !== input.gate) {
    throw new Error(`${input.gate} payment satisfaction does not match the commercial gate.`);
  }
}
