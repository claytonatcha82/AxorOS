import type { ExternalIntegration, IntegrationRequest, IntegrationResponse } from './integration-contract.js';
import {
  validatePaymentRequestInitializationInput,
  type PaymentRequestInitializationInput,
  type PaymentRequestInitializationOutput,
} from './payment-request-integration.js';

interface PaystackInitializeResponse {
  status?: boolean;
  message?: string;
  data?: {
    authorization_url?: string;
    access_code?: string;
    reference?: string;
  };
}

export interface PaystackPaymentRequestIntegrationOptions {
  secretKey: string;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
}

function expectedModeForKey(secretKey: string): 'sandbox' | 'live' {
  if (secretKey.startsWith('sk_test_')) return 'sandbox';
  if (secretKey.startsWith('sk_live_')) return 'live';
  throw new Error('Paystack secret key must be a test or live secret key.');
}

function blocked(
  request: IntegrationRequest<PaymentRequestInitializationInput>,
): IntegrationResponse<PaymentRequestInitializationOutput> {
  return {
    integrationId: 'payment.paystack.request',
    operation: request.operation,
    provider: 'paystack',
    mode: request.mode,
    status: 'blocked',
    output: {
      commercialRecordReference: request.input.commercialRecordReference,
      requirementReference: request.input.requirementReference,
      providerPaymentReference: request.input.providerPaymentReference,
    },
    evidenceReferences: [],
    retryable: false,
  };
}

export function createPaystackPaymentRequestIntegration(
  options: PaystackPaymentRequestIntegrationOptions,
): ExternalIntegration<PaymentRequestInitializationInput, PaymentRequestInitializationOutput> {
  const secretKey = options.secretKey.trim();
  const configuredMode = expectedModeForKey(secretKey);
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = (options.baseUrl ?? 'https://api.paystack.co').replace(/\/$/, '');

  return {
    integrationId: 'payment.paystack.request',
    kind: 'payment',
    provider: 'paystack',
    supportedModes: [configuredMode],
    supportedOperations: ['initialize_payment_request'],

    async execute(request) {
      if (request.operation !== 'initialize_payment_request') return blocked(request);
      if (request.requestedBy !== 'finance_agent') return blocked(request);
      if (request.mode !== configuredMode) return blocked(request);
      if (validatePaymentRequestInitializationInput(request.input).length > 0) return blocked(request);

      let response: Response;
      try {
        response = await fetchImpl(`${baseUrl}/transaction/initialize`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${secretKey}`,
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            email: request.input.recipientEmail.trim(),
            amount: request.input.amountMinor,
            currency: request.input.currency.trim(),
            reference: request.input.providerPaymentReference.trim(),
            metadata: {
              commercialRecordReference: request.input.commercialRecordReference,
              requirementReference: request.input.requirementReference,
            },
          }),
        });
      } catch {
        return {
          ...blocked(request),
          status: 'failed',
          retryable: true,
        };
      }

      let payload: PaystackInitializeResponse;
      try {
        payload = await response.json() as PaystackInitializeResponse;
      } catch {
        return {
          ...blocked(request),
          status: 'failed',
          retryable: response.status >= 500,
        };
      }

      const providerPaymentReference = payload.data?.reference?.trim() || request.input.providerPaymentReference.trim();
      const authorizationUrl = payload.data?.authorization_url?.trim();
      const accessCode = payload.data?.access_code?.trim();
      const succeeded = response.ok && payload.status === true && Boolean(authorizationUrl) && Boolean(accessCode);
      const evidenceReferences = succeeded
        ? [`payment-paystack-request:${providerPaymentReference}`]
        : [];

      return {
        integrationId: 'payment.paystack.request',
        operation: request.operation,
        provider: 'paystack',
        mode: request.mode,
        status: succeeded ? 'succeeded' : 'failed',
        output: {
          commercialRecordReference: request.input.commercialRecordReference,
          requirementReference: request.input.requirementReference,
          providerPaymentReference,
          ...(authorizationUrl ? { authorizationUrl } : {}),
          ...(accessCode ? { accessCode } : {}),
        },
        ...(succeeded ? { externalReference: providerPaymentReference } : {}),
        evidenceReferences,
        retryable: response.status >= 500,
      };
    },
  };
}
