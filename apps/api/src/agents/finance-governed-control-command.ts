import { randomUUID } from 'node:crypto';
import type { CommercialPaymentGate } from '../data/commercial-payment-requirement-postgres-store.js';
import type { PaymentWebhookEvidence } from '../integrations/payment-webhook-evidence.js';
import type { FinanceGovernedBindingInput } from './finance-governed-binding-service.js';
import type { FinanceGovernedOperationalRuntimeResult } from './finance-governed-operational-runtime.js';

export interface FinanceGovernedControlAssessmentInput {
  commercialRecordReference: string;
  gate: CommercialPaymentGate;
  provider: string;
  providerPaymentReference: string;
}

export interface FinanceGovernedControlBindInput extends FinanceGovernedControlAssessmentInput {
  trustedPaymentWebhookIdempotencyKey: string;
}

export interface FinanceGovernedControlDependencies {
  operationalRuntime: {
    assess(input: FinanceGovernedControlAssessmentInput): Promise<FinanceGovernedOperationalRuntimeResult>;
  };
  bindingService: {
    bind(input: FinanceGovernedBindingInput): Promise<{
      before: { state: string };
      binding: {
        clearance: { decision: { clearanceId: string; state: string } };
        satisfactionPersistence: 'accepted' | 'duplicate' | 'not_satisfied';
      };
      after: { state: string };
    }>;
  };
  paymentWebhookEvidenceStore: {
    get(idempotencyKey: string): Promise<PaymentWebhookEvidence | null>;
  };
}

function required(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} is required.`);
  return normalized;
}

export function createFinanceGovernedControlCommand(dependencies: FinanceGovernedControlDependencies) {
  return {
    async assess(input: FinanceGovernedControlAssessmentInput) {
      return dependencies.operationalRuntime.assess({
        commercialRecordReference: required(input.commercialRecordReference, 'commercialRecordReference'),
        gate: input.gate,
        provider: required(input.provider, 'provider'),
        providerPaymentReference: required(input.providerPaymentReference, 'providerPaymentReference'),
      });
    },

    async bind(input: FinanceGovernedControlBindInput) {
      const commercialRecordReference = required(input.commercialRecordReference, 'commercialRecordReference');
      const provider = required(input.provider, 'provider');
      const providerPaymentReference = required(input.providerPaymentReference, 'providerPaymentReference');
      const trustedPaymentWebhookIdempotencyKey = required(
        input.trustedPaymentWebhookIdempotencyKey,
        'trustedPaymentWebhookIdempotencyKey',
      );

      const evidence = await dependencies.paymentWebhookEvidenceStore.get(trustedPaymentWebhookIdempotencyKey);
      if (!evidence) throw new Error('Trusted persisted payment webhook evidence was not found.');
      if (evidence.provider !== provider) {
        throw new Error('Trusted payment evidence provider does not match the requested Finance payment identifier.');
      }
      if (evidence.providerPaymentReference !== providerPaymentReference) {
        throw new Error('Trusted payment evidence reference does not match the requested Finance payment identifier.');
      }
      if (evidence.commercialRecordReference !== commercialRecordReference) {
        throw new Error('Trusted payment evidence does not match the requested commercial record.');
      }

      const beforeAudit = await dependencies.operationalRuntime.assess({
        commercialRecordReference,
        gate: input.gate,
        provider,
        providerPaymentReference,
      });
      if (beforeAudit.decision.state !== 'READY_TO_BIND_REQUIREMENT') {
        throw new Error(
          `Finance control-plane binding requires READY_TO_BIND_REQUIREMENT; received ${beforeAudit.decision.state}.`,
        );
      }

      const nonce = randomUUID();
      const result = await dependencies.bindingService.bind({
        commercialRecordReference,
        gate: input.gate,
        provider,
        providerPaymentReference,
        trustedPaymentWebhookIdempotencyKey,
        clearanceId: `finance-clearance:control:${nonce}`,
        executionId: `exec:finance-control:${nonce}`,
        correlationId: `corr:finance-control:${nonce}`,
      });

      const afterAudit = await dependencies.operationalRuntime.assess({
        commercialRecordReference,
        gate: input.gate,
        provider,
        providerPaymentReference,
      });
      if (afterAudit.decision.state !== 'REQUIREMENT_SATISFIED') {
        throw new Error(
          `Finance control-plane binding did not persist REQUIREMENT_SATISFIED; received ${afterAudit.decision.state}.`,
        );
      }

      return {
        before: beforeAudit.decision,
        beforeAuditEventReference: beforeAudit.auditEventReference,
        clearanceId: result.binding.clearance.decision.clearanceId,
        satisfactionPersistence: result.binding.satisfactionPersistence,
        after: afterAudit.decision,
        afterAuditEventReference: afterAudit.auditEventReference,
      };
    },
  };
}
