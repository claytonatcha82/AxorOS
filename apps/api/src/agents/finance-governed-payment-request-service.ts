import { createHash } from 'node:crypto';
import type {
  CommercialPaymentGate,
  CommercialPaymentRequirementPostgresStore,
  PersistedCommercialPaymentRequirement,
} from '../data/commercial-payment-requirement-postgres-store.js';
import type { IntegrationMode } from '../integrations/integration-contract.js';
import type { IntegrationRegistry } from '../integrations/integration-registry.js';
import {
  hasUsablePaymentRequest,
  type PaymentRequestInitializationOutput,
} from '../integrations/payment-request-integration.js';

export interface FinanceGovernedPaymentRequestServiceOptions {
  requirementStore: Pick<CommercialPaymentRequirementPostgresStore, 'get'>;
  integrations: Pick<IntegrationRegistry, 'execute'>;
  integrationId?: string;
  mode?: Extract<IntegrationMode, 'sandbox' | 'live'>;
}

export interface FinanceGovernedPaymentRequestInput {
  commercialRecordReference: string;
  gate: CommercialPaymentGate;
  recipientEmail: string;
  executionId: string;
  correlationId: string;
}

export interface FinanceGovernedPaymentRequestResult {
  requirement: PersistedCommercialPaymentRequirement;
  providerPaymentReference: string;
  authorizationUrl: string;
  accessCode: string;
  evidenceReferences: string[];
}

function required(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

function providerPaymentReference(requirement: PersistedCommercialPaymentRequirement): string {
  const digest = createHash('sha256')
    .update(`${requirement.commercialRecordReference}|${requirement.gate}|${requirement.requirementReference}`)
    .digest('hex')
    .slice(0, 24)
    .toUpperCase();
  return `AXOROS-${digest}`;
}

export function createFinanceGovernedPaymentRequestService(
  options: FinanceGovernedPaymentRequestServiceOptions,
) {
  const integrationId = options.integrationId ?? 'payment.paystack.request';
  const mode = options.mode ?? 'sandbox';

  return {
    async initialize(input: FinanceGovernedPaymentRequestInput): Promise<FinanceGovernedPaymentRequestResult> {
      const commercialRecordReference = required(input.commercialRecordReference, 'commercialRecordReference');
      const recipientEmail = required(input.recipientEmail, 'recipientEmail');
      const executionId = required(input.executionId, 'executionId');
      const correlationId = required(input.correlationId, 'correlationId');

      const requirement = await options.requirementStore.get(commercialRecordReference, input.gate);
      if (!requirement) {
        throw new Error(`No persisted commercial payment requirement exists for ${commercialRecordReference}:${input.gate}.`);
      }
      if (requirement.status !== 'ACTIVE') {
        throw new Error(`Commercial payment requirement ${requirement.requirementReference} is not ACTIVE.`);
      }
      if (!Number.isSafeInteger(requirement.requiredAmountMinor) || requirement.requiredAmountMinor <= 0) {
        throw new Error(`Commercial payment requirement ${requirement.requirementReference} has an invalid amount.`);
      }
      if (!/^[A-Z]{3}$/.test(requirement.currency)) {
        throw new Error(`Commercial payment requirement ${requirement.requirementReference} has an invalid currency.`);
      }

      const generatedProviderPaymentReference = providerPaymentReference(requirement);
      const response = await options.integrations.execute<
        {
          commercialRecordReference: string;
          requirementReference: string;
          providerPaymentReference: string;
          recipientEmail: string;
          amountMinor: number;
          currency: string;
        },
        PaymentRequestInitializationOutput
      >({
        integrationId,
        operation: 'initialize_payment_request',
        requestedBy: 'finance_agent',
        executionId,
        correlationId,
        mode,
        risk: 'medium',
        idempotencyKey: `finance-payment-request:${requirement.requirementReference}:${generatedProviderPaymentReference}`,
        input: {
          commercialRecordReference: requirement.commercialRecordReference,
          requirementReference: requirement.requirementReference,
          providerPaymentReference: generatedProviderPaymentReference,
          recipientEmail,
          amountMinor: requirement.requiredAmountMinor,
          currency: requirement.currency,
        },
      });

      if (!hasUsablePaymentRequest(response)) {
        throw new Error('Payment provider did not return usable governed payment-request authority.');
      }
      if (response.output.commercialRecordReference !== requirement.commercialRecordReference) {
        throw new Error('Payment-request provider response commercial record does not match the persisted requirement.');
      }
      if (response.output.requirementReference !== requirement.requirementReference) {
        throw new Error('Payment-request provider response requirement does not match the persisted requirement.');
      }
      if (response.output.providerPaymentReference !== generatedProviderPaymentReference) {
        throw new Error('Payment-request provider response reference does not match the Finance-generated reference.');
      }

      return {
        requirement,
        providerPaymentReference: generatedProviderPaymentReference,
        authorizationUrl: response.output.authorizationUrl!,
        accessCode: response.output.accessCode!,
        evidenceReferences: response.evidenceReferences,
      };
    },
  };
}
