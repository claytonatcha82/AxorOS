import type { CommercialPaymentGate } from '../data/commercial-payment-requirement-postgres-store.js';
import type { WorkflowEventRecord } from '../data/operational-repository.js';
import type { FinanceGovernedOperationalDecision } from './finance-governed-operational-coordinator.js';

export interface FinanceGovernedOperationalRuntimeCoordinator {
  assess(input: {
    commercialRecordReference: string;
    gate: CommercialPaymentGate;
    provider: string;
    providerPaymentReference: string;
  }): Promise<FinanceGovernedOperationalDecision>;
}

export interface FinanceGovernedOperationalRuntimeEventStore {
  createWorkflowEvent(input: {
    eventType: string;
    actorType: 'agent';
    actorId: string;
    payload: unknown;
  }): Promise<WorkflowEventRecord>;
}

export interface FinanceGovernedOperationalRuntimeDependencies {
  coordinator: FinanceGovernedOperationalRuntimeCoordinator;
  eventStore: FinanceGovernedOperationalRuntimeEventStore;
}

export interface FinanceGovernedOperationalRuntimeInput {
  commercialRecordReference: string;
  gate: CommercialPaymentGate;
  provider: string;
  providerPaymentReference: string;
}

export interface FinanceGovernedOperationalRuntimeResult {
  decision: FinanceGovernedOperationalDecision;
  auditEventReference: string;
}

export function createFinanceGovernedOperationalRuntime(
  dependencies: FinanceGovernedOperationalRuntimeDependencies,
) {
  return {
    async assess(input: FinanceGovernedOperationalRuntimeInput): Promise<FinanceGovernedOperationalRuntimeResult> {
      const decision = await dependencies.coordinator.assess(input);
      const event = await dependencies.eventStore.createWorkflowEvent({
        eventType: 'finance_operational_assessment',
        actorType: 'agent',
        actorId: 'finance_agent',
        payload: {
          commercialRecordReference: decision.commercialRecordReference,
          gate: decision.gate,
          state: decision.state,
          reason: decision.reason,
          advisoryModelAllowed: decision.advisoryModelAllowed,
          ...(decision.requirementReference ? { requirementReference: decision.requirementReference } : {}),
          ...(decision.clearanceId ? { clearanceId: decision.clearanceId } : {}),
          ...(decision.paymentEvidenceReference ? { paymentEvidenceReference: decision.paymentEvidenceReference } : {}),
          ...(decision.paymentStatus ? { paymentStatus: decision.paymentStatus } : {}),
          ...(decision.authorityState ? { authorityState: decision.authorityState } : {}),
          provider: input.provider.trim(),
          providerPaymentReference: input.providerPaymentReference.trim(),
        },
      });

      return {
        decision,
        auditEventReference: `workflow-event:${event.id}`,
      };
    },
  };
}
