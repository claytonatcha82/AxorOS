import type { ExternalIntegration, IntegrationRequest, IntegrationResponse } from './integration-contract.js';
import {
  validatePaymentVerificationInput,
  type PaymentVerificationInput,
  type PaymentVerificationOutput,
} from './payment-integration.js';

interface PaystackVerifyResponse {
  status?: boolean;
  message?: string;
  data?: {
    id?: number | string;
    status?: string;
    reference?: string;
    amount?: number;
    currency?: string;
    paid_at?: string | null;
    created_at?: string | null;
  };
}

export interface PaystackPaymentIntegrationOptions {
  secretKey: string;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
}

function verificationStatus(status: string | undefined): PaymentVerificationOutput['verificationStatus'] {
  switch (status) {
    case 'success': return 'verified_paid';
    case 'pending':
    case 'processing':
    case 'ongoing':
    case 'queued': return 'pending';
    case 'failed':
    case 'abandoned': return 'failed';
    // Paystack's `reversed` status can represent either a refund or a chargeback.
    // Do not collapse that ambiguity into a trusted refund classification here.
    case 'reversed': return 'unknown';
    default: return 'unknown';
  }
}

function expectedModeForKey(secretKey: string): 'sandbox' | 'live' {
  if (secretKey.startsWith('sk_test_')) return 'sandbox';
  if (secretKey.startsWith('sk_live_')) return 'live';
  throw new Error('Paystack secret key must be a test or live secret key.');
}

export function createPaystackPaymentIntegration(
  options: PaystackPaymentIntegrationOptions,
): ExternalIntegration<PaymentVerificationInput, PaymentVerificationOutput> {
  const secretKey = options.secretKey.trim();
  const configuredMode = expectedModeForKey(secretKey);
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = (options.baseUrl ?? 'https://api.paystack.co').replace(/\/$/, '');

  return {
    integrationId: 'payment.paystack',
    kind: 'payment',
    provider: 'paystack',
    supportedModes: [configuredMode],
    supportedOperations: ['verify_payment'],

    async execute(
      request: IntegrationRequest<PaymentVerificationInput>,
    ): Promise<IntegrationResponse<PaymentVerificationOutput>> {
      if (request.operation !== 'verify_payment') {
        return {
          integrationId: 'payment.paystack',
          operation: request.operation,
          provider: 'paystack',
          mode: request.mode,
          status: 'blocked',
          output: {
            providerPaymentReference: request.input.providerPaymentReference,
            commercialRecordReference: request.input.commercialRecordReference,
            verificationStatus: 'unknown',
          },
          evidenceReferences: [],
          retryable: false,
        };
      }

      if (request.requestedBy !== 'finance_agent') {
        return {
          integrationId: 'payment.paystack',
          operation: request.operation,
          provider: 'paystack',
          mode: request.mode,
          status: 'blocked',
          output: {
            providerPaymentReference: request.input.providerPaymentReference,
            commercialRecordReference: request.input.commercialRecordReference,
            verificationStatus: 'unknown',
          },
          evidenceReferences: [],
          retryable: false,
        };
      }

      if (request.mode !== configuredMode) {
        return {
          integrationId: 'payment.paystack',
          operation: request.operation,
          provider: 'paystack',
          mode: request.mode,
          status: 'blocked',
          output: {
            providerPaymentReference: request.input.providerPaymentReference,
            commercialRecordReference: request.input.commercialRecordReference,
            verificationStatus: 'unknown',
          },
          evidenceReferences: [],
          retryable: false,
        };
      }

      const inputErrors = validatePaymentVerificationInput(request.input);
      if (inputErrors.length > 0) {
        return {
          integrationId: 'payment.paystack',
          operation: request.operation,
          provider: 'paystack',
          mode: request.mode,
          status: 'blocked',
          output: {
            providerPaymentReference: request.input.providerPaymentReference,
            commercialRecordReference: request.input.commercialRecordReference,
            verificationStatus: 'unknown',
          },
          evidenceReferences: [],
          retryable: false,
        };
      }

      const reference = encodeURIComponent(request.input.providerPaymentReference);
      let response: Response;
      try {
        response = await fetchImpl(`${baseUrl}/transaction/verify/${reference}`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${secretKey}`,
            Accept: 'application/json',
          },
        });
      } catch {
        return {
          integrationId: 'payment.paystack',
          operation: request.operation,
          provider: 'paystack',
          mode: request.mode,
          status: 'failed',
          output: {
            providerPaymentReference: request.input.providerPaymentReference,
            commercialRecordReference: request.input.commercialRecordReference,
            verificationStatus: 'unknown',
          },
          evidenceReferences: [],
          retryable: true,
        };
      }

      let payload: PaystackVerifyResponse;
      try {
        payload = await response.json() as PaystackVerifyResponse;
      } catch {
        return {
          integrationId: 'payment.paystack',
          operation: request.operation,
          provider: 'paystack',
          mode: request.mode,
          status: 'failed',
          output: {
            providerPaymentReference: request.input.providerPaymentReference,
            commercialRecordReference: request.input.commercialRecordReference,
            verificationStatus: 'unknown',
          },
          evidenceReferences: [],
          retryable: response.status >= 500,
        };
      }

      const providerReference = payload.data?.reference?.trim() || request.input.providerPaymentReference;
      const providerEventReference = payload.data?.id === undefined
        ? undefined
        : `transaction:${String(payload.data.id)}`;
      const status = verificationStatus(payload.data?.status);
      const verifiedAt = payload.data?.paid_at ?? payload.data?.created_at ?? undefined;
      const amountMinor = Number.isSafeInteger(payload.data?.amount) ? payload.data?.amount : undefined;
      const currency = typeof payload.data?.currency === 'string' ? payload.data.currency.trim().toUpperCase() : undefined;
      const evidenceReferences = providerEventReference
        ? [`payment-paystack-verify:${providerEventReference}:${providerReference}`]
        : [];

      const output: PaymentVerificationOutput = {
        providerPaymentReference: providerReference,
        commercialRecordReference: request.input.commercialRecordReference,
        verificationStatus: status,
        ...(amountMinor !== undefined ? { amountMinor } : {}),
        ...(currency ? { currency } : {}),
        ...(providerEventReference ? { providerEventReference } : {}),
        ...(verifiedAt ? { verifiedAt } : {}),
      };

      const succeeded = response.ok && payload.status === true;
      return {
        integrationId: 'payment.paystack',
        operation: request.operation,
        provider: 'paystack',
        mode: request.mode,
        status: succeeded ? 'succeeded' : 'failed',
        output,
        ...(providerEventReference ? { externalReference: providerEventReference } : {}),
        evidenceReferences,
        retryable: response.status >= 500,
      };
    },
  };
}
