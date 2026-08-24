import type { CommercialPaymentGate } from '../data/commercial-payment-requirement-postgres-store.js';
import type { WorkflowEventRecord } from '../data/operational-repository.js';
import type { FinanceGovernedOperationalDecision } from './finance-governed-operational-coordinator.js';
import type { FinanceLedgerReconciliationResult } from './finance-ledger-reconciliation.js';

export interface FinanceGovernedOperationalRuntimeCoordinator {
  assess(input: {
    commercialRecordReference: string;
    gate: CommercialPaymentGate;
    provider: string;
    providerPaymentReference: string;
  }): Promise<FinanceGovernedOperationalDecision>;
}

export interface FinanceGovernedOperationalRuntimeReconciliationService {
  reconcile(commercialRecordReference: string): Promise<FinanceLedgerReconciliationResult>;
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
  reconciliationService: FinanceGovernedOperationalRuntimeReconciliationService;
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
  reconciliation: FinanceLedgerReconciliationResult;
  auditEventReference: string;
}

export function createFinanceGovernedOperationalRuntime(
  dependencies: FinanceGovernedOperationalRuntimeDependencies,
) {
  return {
    async assess(input: FinanceGovernedOperationalRuntimeInput): Promise<FinanceGovernedOperationalRuntimeResult> {
      const commercialRecordReference = input.commercialRecordReference.trim();
      const reconciliation = await dependencies.reconciliationService.reconcile(commercialRecordReference);
      const decision: FinanceGovernedOperationalDecision = reconciliation.reconciled
        ? await dependencies.coordinator.assess(input)
        : {
            commercialRecordReference,
            gate: input.gate,
            state: 'MANUAL_REVIEW',
            reason: `Finance ledger reconciliation failed: ${reconciliation.issues.map((issue) => issue.code).join(', ')}.`,
            advisoryModelAllowed: true,
          };

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
          reconciliation: {
            reconciled: reconciliation.reconciled,
            entryTypes: reconciliation.entryTypes,
            issues: reconciliation.issues,
          },
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
        reconciliation,
        auditEventReference: `workflow-event:${event.id}`,
      };
    },
  };
}
