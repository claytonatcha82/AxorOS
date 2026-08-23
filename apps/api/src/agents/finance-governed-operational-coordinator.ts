import type { CommercialPaymentGate, PersistedCommercialPaymentRequirement } from '../data/commercial-payment-requirement-postgres-store.js';
import type { PersistedCommercialPaymentSatisfaction } from '../data/commercial-payment-satisfaction-postgres-store.js';
import type { PersistedFinancePaymentCurrentState } from '../data/finance-payment-current-state-postgres-store.js';

export type FinanceOperationalDecisionState =
  | 'BLOCKED_MISSING_REQUIREMENT'
  | 'BLOCKED_REQUIREMENT_INACTIVE'
  | 'AWAITING_VERIFIED_PAYMENT'
  | 'PAYMENT_BLOCKED'
  | 'MANUAL_REVIEW'
  | 'READY_TO_BIND_REQUIREMENT'
  | 'REQUIREMENT_SATISFIED';

export interface FinanceGovernedOperationalDecision {
  commercialRecordReference: string;
  gate: CommercialPaymentGate;
  state: FinanceOperationalDecisionState;
  reason: string;
  requirementReference?: string;
  clearanceId?: string;
  paymentEvidenceReference?: string;
  paymentStatus?: PersistedFinancePaymentCurrentState['paymentStatus'];
  authorityState?: PersistedFinancePaymentCurrentState['authorityState'];
  advisoryModelAllowed: boolean;
}

export interface FinanceGovernedOperationalCoordinatorDependencies {
  requirementStore: {
    get(commercialRecordReference: string, gate: CommercialPaymentGate): Promise<PersistedCommercialPaymentRequirement | null>;
  };
  satisfactionStore: {
    get(requirementReference: string): Promise<PersistedCommercialPaymentSatisfaction | null>;
  };
  currentStateStore: {
    get(provider: string, providerPaymentReference: string): Promise<PersistedFinancePaymentCurrentState | null>;
  };
}

export interface FinanceGovernedOperationalAssessmentInput {
  commercialRecordReference: string;
  gate: CommercialPaymentGate;
  provider: string;
  providerPaymentReference: string;
}

function normalized(value: string, label: string): string {
  const result = value.trim();
  if (!result) throw new Error(`${label} is required.`);
  return result;
}

export function createFinanceGovernedOperationalCoordinator(
  dependencies: FinanceGovernedOperationalCoordinatorDependencies,
) {
  return {
    async assess(input: FinanceGovernedOperationalAssessmentInput): Promise<FinanceGovernedOperationalDecision> {
      const commercialRecordReference = normalized(input.commercialRecordReference, 'Finance commercial record reference');
      const provider = normalized(input.provider, 'Finance payment provider');
      const providerPaymentReference = normalized(input.providerPaymentReference, 'Finance provider payment reference');
      const { gate } = input;

      const requirement = await dependencies.requirementStore.get(commercialRecordReference, gate);
      if (!requirement) {
        return {
          commercialRecordReference,
          gate,
          state: 'BLOCKED_MISSING_REQUIREMENT',
          reason: 'No governed commercial payment requirement exists for this gate.',
          advisoryModelAllowed: true,
        };
      }

      if (requirement.status !== 'ACTIVE' && requirement.status !== 'SATISFIED') {
        return {
          commercialRecordReference,
          gate,
          state: 'BLOCKED_REQUIREMENT_INACTIVE',
          reason: `Commercial payment requirement is ${requirement.status.toLowerCase()} and cannot authorize this gate.`,
          requirementReference: requirement.requirementReference,
          advisoryModelAllowed: true,
        };
      }

      const satisfaction = await dependencies.satisfactionStore.get(requirement.requirementReference);
      if (satisfaction) {
        if (satisfaction.commercialRecordReference !== commercialRecordReference || satisfaction.gate !== gate) {
          throw new Error('Persisted commercial payment satisfaction does not match the requested Finance gate.');
        }
        return {
          commercialRecordReference,
          gate,
          state: 'REQUIREMENT_SATISFIED',
          reason: 'A matching immutable commercial payment satisfaction already authorizes this gate.',
          requirementReference: requirement.requirementReference,
          clearanceId: satisfaction.clearanceId,
          advisoryModelAllowed: true,
        };
      }

      const currentState = await dependencies.currentStateStore.get(provider, providerPaymentReference);
      if (!currentState) {
        return {
          commercialRecordReference,
          gate,
          state: 'AWAITING_VERIFIED_PAYMENT',
          reason: 'No authoritative provider payment state has been persisted for this reference.',
          requirementReference: requirement.requirementReference,
          advisoryModelAllowed: true,
        };
      }

      if (currentState.commercialRecordReference !== commercialRecordReference) {
        return {
          commercialRecordReference,
          gate,
          state: 'MANUAL_REVIEW',
          reason: 'Authoritative provider payment state belongs to a different commercial record.',
          requirementReference: requirement.requirementReference,
          paymentEvidenceReference: currentState.latestEvidenceReference,
          paymentStatus: currentState.paymentStatus,
          authorityState: currentState.authorityState,
          advisoryModelAllowed: true,
        };
      }

      if (currentState.authorityState === 'MANUAL_REVIEW') {
        return {
          commercialRecordReference,
          gate,
          state: 'MANUAL_REVIEW',
          reason: currentState.reason,
          requirementReference: requirement.requirementReference,
          paymentEvidenceReference: currentState.latestEvidenceReference,
          paymentStatus: currentState.paymentStatus,
          authorityState: currentState.authorityState,
          advisoryModelAllowed: true,
        };
      }

      if (currentState.authorityState !== 'AUTHORIZED' || currentState.paymentStatus !== 'CONFIRMED') {
        return {
          commercialRecordReference,
          gate,
          state: 'PAYMENT_BLOCKED',
          reason: currentState.reason,
          requirementReference: requirement.requirementReference,
          paymentEvidenceReference: currentState.latestEvidenceReference,
          paymentStatus: currentState.paymentStatus,
          authorityState: currentState.authorityState,
          advisoryModelAllowed: true,
        };
      }

      return {
        commercialRecordReference,
        gate,
        state: 'READY_TO_BIND_REQUIREMENT',
        reason: 'Verified provider payment evidence supports governed commercial payment binding, but the requirement is not yet satisfied.',
        requirementReference: requirement.requirementReference,
        paymentEvidenceReference: currentState.latestEvidenceReference,
        paymentStatus: currentState.paymentStatus,
        authorityState: currentState.authorityState,
        advisoryModelAllowed: true,
      };
    },
  };
}
