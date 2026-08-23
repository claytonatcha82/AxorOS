import type { CommercialPaymentGate } from '../data/commercial-payment-requirement-postgres-store.js';
import type { IntegrationMode } from '../integrations/integration-contract.js';
import type { BindCommercialPaymentResult } from './finance-commercial-payment-binding-workflow.js';
import type { FinanceGovernedOperationalDecision } from './finance-governed-operational-coordinator.js';

export interface FinanceGovernedBindingAssessmentReader {
  assess(input: {
    commercialRecordReference: string;
    gate: CommercialPaymentGate;
    provider: string;
    providerPaymentReference: string;
  }): Promise<FinanceGovernedOperationalDecision>;
}

export interface FinanceGovernedCommercialBindingWorkflow {
  bindAndSatisfy(input: {
    commercialRecordReference: string;
    gate: CommercialPaymentGate;
    trustedPaymentWebhookIdempotencyKey: string;
    clearanceId: string;
    executionId: string;
    correlationId: string;
    paymentIntegrationId: string;
    mode: IntegrationMode;
  }): Promise<BindCommercialPaymentResult>;
}

export interface FinanceGovernedBindingServiceDependencies {
  coordinator: FinanceGovernedBindingAssessmentReader;
  bindingWorkflow: FinanceGovernedCommercialBindingWorkflow;
  paymentIntegrationId: string;
  mode: IntegrationMode;
}

export interface FinanceGovernedBindingInput {
  commercialRecordReference: string;
  gate: CommercialPaymentGate;
  provider: string;
  providerPaymentReference: string;
  trustedPaymentWebhookIdempotencyKey: string;
  clearanceId: string;
  executionId: string;
  correlationId: string;
}

function required(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} is required.`);
  return normalized;
}

export function createFinanceGovernedBindingService(
  dependencies: FinanceGovernedBindingServiceDependencies,
) {
  return {
    async bind(input: FinanceGovernedBindingInput) {
      const commercialRecordReference = required(input.commercialRecordReference, 'commercialRecordReference');
      const provider = required(input.provider, 'provider');
      const providerPaymentReference = required(input.providerPaymentReference, 'providerPaymentReference');
      const trustedPaymentWebhookIdempotencyKey = required(
        input.trustedPaymentWebhookIdempotencyKey,
        'trustedPaymentWebhookIdempotencyKey',
      );
      const clearanceId = required(input.clearanceId, 'clearanceId');
      const executionId = required(input.executionId, 'executionId');
      const correlationId = required(input.correlationId, 'correlationId');

      const before = await dependencies.coordinator.assess({
        commercialRecordReference,
        gate: input.gate,
        provider,
        providerPaymentReference,
      });

      if (before.state !== 'READY_TO_BIND_REQUIREMENT') {
        throw new Error(`Finance governed binding requires READY_TO_BIND_REQUIREMENT; received ${before.state}.`);
      }

      const binding = await dependencies.bindingWorkflow.bindAndSatisfy({
        commercialRecordReference,
        gate: input.gate,
        trustedPaymentWebhookIdempotencyKey,
        clearanceId,
        executionId,
        correlationId,
        paymentIntegrationId: dependencies.paymentIntegrationId,
        mode: dependencies.mode,
      });

      if (binding.clearance.decision.state !== 'FINANCE_CLEARED') {
        throw new Error('Finance governed binding did not produce FINANCE_CLEARED authority.');
      }
      if (binding.satisfactionPersistence === 'not_satisfied') {
        throw new Error('Finance governed binding did not persist commercial payment satisfaction.');
      }

      const after = await dependencies.coordinator.assess({
        commercialRecordReference,
        gate: input.gate,
        provider,
        providerPaymentReference,
      });

      if (after.state !== 'REQUIREMENT_SATISFIED') {
        throw new Error(`Finance governed binding did not reach REQUIREMENT_SATISFIED; received ${after.state}.`);
      }

      return { before, binding, after };
    },
  };
}
