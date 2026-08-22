import type {
  CommercialPaymentGate,
  PersistedCommercialPaymentRequirement,
} from '../data/commercial-payment-requirement-postgres-store.js';
import type { PersistedCommercialPaymentSatisfaction } from '../data/commercial-payment-satisfaction-postgres-store.js';
import type { PaymentWebhookEvidence } from '../integrations/payment-webhook-evidence.js';
import type { IntegrationMode } from '../integrations/integration-contract.js';
import type { VerifyFinancePaymentResult } from './finance-payment-clearance-workflow.js';

export interface CommercialPaymentRequirementReader {
  get(
    commercialRecordReference: string,
    gate: CommercialPaymentGate,
  ): Promise<PersistedCommercialPaymentRequirement | null>;
}

export interface CommercialPaymentSatisfactionWriter {
  save(satisfaction: PersistedCommercialPaymentSatisfaction): Promise<'accepted' | 'duplicate'>;
}

export interface TrustedCommercialPaymentEvidenceReader {
  get(idempotencyKey: string): Promise<PaymentWebhookEvidence | null>;
}

export interface CommercialPaymentFinanceClearanceWorkflow {
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
    trustedPaymentWebhookIdempotencyKey: string;
  }): Promise<VerifyFinancePaymentResult>;
}

export interface BindCommercialPaymentInput {
  commercialRecordReference: string;
  gate: CommercialPaymentGate;
  trustedPaymentWebhookIdempotencyKey: string;
  clearanceId: string;
  executionId: string;
  correlationId: string;
  paymentIntegrationId: string;
  mode: IntegrationMode;
}

export interface BindCommercialPaymentResult {
  requirement: PersistedCommercialPaymentRequirement;
  evidence: PaymentWebhookEvidence;
  clearance: VerifyFinancePaymentResult;
  satisfactionPersistence: 'accepted' | 'duplicate' | 'not_satisfied';
}

function required(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} is required.`);
  return normalized;
}

function assertEvidenceMatchesRequirement(
  evidence: PaymentWebhookEvidence,
  requirement: PersistedCommercialPaymentRequirement,
): void {
  if (evidence.eventType !== 'payment_paid') {
    throw new Error('Commercial payment requirement can only be satisfied by trusted payment_paid evidence.');
  }
  if (evidence.commercialRecordReference !== requirement.commercialRecordReference) {
    throw new Error('Trusted payment evidence does not match the commercial payment requirement record.');
  }
  if (evidence.amountMinor !== requirement.requiredAmountMinor) {
    throw new Error('Trusted payment evidence amount does not satisfy the commercial payment requirement.');
  }
  if (evidence.currency !== requirement.currency) {
    throw new Error('Trusted payment evidence currency does not satisfy the commercial payment requirement.');
  }
}

export function createFinanceCommercialPaymentBindingWorkflow(dependencies: {
  requirementStore: CommercialPaymentRequirementReader;
  satisfactionStore: CommercialPaymentSatisfactionWriter;
  paymentWebhookEvidenceStore: TrustedCommercialPaymentEvidenceReader;
  clearanceWorkflow: CommercialPaymentFinanceClearanceWorkflow;
}) {
  return {
    async bindAndSatisfy(input: BindCommercialPaymentInput): Promise<BindCommercialPaymentResult> {
      const commercialRecordReference = required(input.commercialRecordReference, 'commercialRecordReference');
      const trustedPaymentWebhookIdempotencyKey = required(
        input.trustedPaymentWebhookIdempotencyKey,
        'trustedPaymentWebhookIdempotencyKey',
      );
      const clearanceId = required(input.clearanceId, 'clearanceId');
      const executionId = required(input.executionId, 'executionId');
      const correlationId = required(input.correlationId, 'correlationId');
      const paymentIntegrationId = required(input.paymentIntegrationId, 'paymentIntegrationId');

      const requirement = await dependencies.requirementStore.get(commercialRecordReference, input.gate);
      if (!requirement) {
        throw new Error(`No commercial payment requirement exists for ${commercialRecordReference}:${input.gate}.`);
      }
      if (requirement.status !== 'ACTIVE') {
        throw new Error(`Commercial payment requirement ${requirement.requirementReference} is not active.`);
      }

      const evidence = await dependencies.paymentWebhookEvidenceStore.get(trustedPaymentWebhookIdempotencyKey);
      if (!evidence) {
        throw new Error('Trusted persisted payment webhook evidence was not found.');
      }
      assertEvidenceMatchesRequirement(evidence, requirement);

      const clearance = await dependencies.clearanceWorkflow.verifyAndPersist({
        clearanceId,
        executionId,
        correlationId,
        paymentIntegrationId,
        mode: input.mode,
        expected: {
          providerPaymentReference: evidence.providerPaymentReference,
          expectedAmountMinor: requirement.requiredAmountMinor,
          currency: requirement.currency,
          commercialRecordReference: requirement.commercialRecordReference,
        },
        trustedPaymentWebhookIdempotencyKey,
      });

      if (clearance.decision.state !== 'FINANCE_CLEARED') {
        return {
          requirement,
          evidence,
          clearance,
          satisfactionPersistence: 'not_satisfied',
        };
      }

      const satisfactionPersistence = await dependencies.satisfactionStore.save({
        requirementReference: requirement.requirementReference,
        clearanceId: clearance.decision.clearanceId,
        commercialRecordReference: requirement.commercialRecordReference,
        gate: requirement.gate,
        satisfiedAt: clearance.decision.verifiedAt,
      });

      return {
        requirement,
        evidence,
        clearance,
        satisfactionPersistence,
      };
    },
  };
}
