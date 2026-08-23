import { createHash } from 'node:crypto';
import type {
  CommercialPaymentGate,
  CommercialPaymentRequirementPostgresStore,
  PersistedCommercialPaymentRequirement,
} from '../data/commercial-payment-requirement-postgres-store.js';
import type {
  FinancePaymentRequestPostgresStore,
  PersistedFinancePaymentRequest,
} from '../data/finance-payment-request-postgres-store.js';
import type { IntegrationMode, IntegrationRequest, IntegrationResponse } from '../integrations/integration-contract.js';
import {
  hasUsablePaymentRequest,
  type PaymentRequestInitializationInput,
  type PaymentRequestInitializationOutput,
} from '../integrations/payment-request-integration.js';

export interface FinancePaymentRequestIntegrationExecutor {
  execute(
    request: IntegrationRequest<PaymentRequestInitializationInput>,
  ): Promise<IntegrationResponse<PaymentRequestInitializationOutput>>;
}

export interface FinanceGovernedPaymentRequestServiceOptions {
  requirementStore: Pick<CommercialPaymentRequirementPostgresStore, 'get'>;
  paymentRequestStore: Pick<FinancePaymentRequestPostgresStore, 'get' | 'save'>;
  integrations: FinancePaymentRequestIntegrationExecutor;
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
  accessCode?: string;
  evidenceReferences: string[];
  replayed: boolean;
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

function assertPersistedRequestMatches(
  persisted: PersistedFinancePaymentRequest,
  requirement: PersistedCommercialPaymentRequirement,
  expectedProviderPaymentReference: string,
): void {
  if (persisted.commercialRecordReference !== requirement.commercialRecordReference
    || persisted.requirementReference !== requirement.requirementReference
    || persisted.providerPaymentReference !== expectedProviderPaymentReference
    || persisted.amountMinor !== requirement.requiredAmountMinor
    || persisted.currency !== requirement.currency) {
    throw new Error(`Persisted Finance payment request does not match requirement ${requirement.requirementReference}.`);
  }
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
      const existing = await options.paymentRequestStore.get(requirement.requirementReference);
      if (existing) {
        assertPersistedRequestMatches(existing, requirement, generatedProviderPaymentReference);
        return {
          requirement,
          providerPaymentReference: existing.providerPaymentReference,
          authorizationUrl: existing.authorizationUrl,
          evidenceReferences: existing.evidenceReferences,
          replayed: true,
        };
      }

      const request: IntegrationRequest<PaymentRequestInitializationInput> = {
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
      };
      const response = await options.integrations.execute(request);

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

      const persisted: PersistedFinancePaymentRequest = {
        requirementReference: requirement.requirementReference,
        commercialRecordReference: requirement.commercialRecordReference,
        provider: response.provider,
        providerPaymentReference: generatedProviderPaymentReference,
        authorizationUrl: response.output.authorizationUrl!,
        amountMinor: requirement.requiredAmountMinor,
        currency: requirement.currency,
        evidenceReferences: response.evidenceReferences,
        createdAt: new Date().toISOString(),
      };
      await options.paymentRequestStore.save(persisted);

      return {
        requirement,
        providerPaymentReference: generatedProviderPaymentReference,
        authorizationUrl: response.output.authorizationUrl!,
        accessCode: response.output.accessCode!,
        evidenceReferences: response.evidenceReferences,
        replayed: false,
      };
    },
  };
}
