import type { ExternalIntegration, IntegrationRequest } from './integration-contract.js';
import type { PaymentVerificationInput, PaymentVerificationOutput, PaymentVerificationResponse } from './payment-integration.js';
import { validatePaymentVerificationInput } from './payment-integration.js';

export class DeterministicPaymentIntegration implements ExternalIntegration<PaymentVerificationInput, PaymentVerificationOutput> {
  readonly integrationId = 'payment.sandbox';
  readonly kind = 'payment' as const;
  readonly provider = 'deterministic-payment-sandbox';
  readonly supportedModes = ['sandbox'] as const;
  readonly supportedOperations = ['verify_payment'] as const;

  async execute(request: IntegrationRequest<PaymentVerificationInput>): Promise<PaymentVerificationResponse> {
    if (request.mode !== 'sandbox') return this.blocked(request, 'Deterministic payment integration only supports sandbox mode.');
    if (request.operation !== 'verify_payment') return this.blocked(request, 'Deterministic payment integration only verifies payment evidence.');
    if (request.requestedBy !== 'finance_agent') return this.blocked(request, 'Only the Finance Agent may request payment verification.');
    const errors = validatePaymentVerificationInput(request.input);
    if (errors.length > 0) return this.blocked(request, errors.join(' '));

    const verified = request.input.providerPaymentReference.startsWith('sandbox_paid_');
    if (!verified) {
      return {
        integrationId: this.integrationId, operation: request.operation, provider: this.provider, mode: request.mode, status: 'succeeded',
        output: {
          providerPaymentReference: request.input.providerPaymentReference,
          commercialRecordReference: request.input.commercialRecordReference,
          verificationStatus: 'pending',
        },
        evidenceReferences: [`payment-sandbox:${request.input.providerPaymentReference}:pending`], retryable: false,
      };
    }

    const providerEventReference = `sandbox_event:${request.input.providerPaymentReference}`;
    return {
      integrationId: this.integrationId, operation: request.operation, provider: this.provider, mode: request.mode, status: 'succeeded',
      output: {
        providerPaymentReference: request.input.providerPaymentReference,
        commercialRecordReference: request.input.commercialRecordReference,
        verificationStatus: 'verified_paid',
        amountMinor: request.input.expectedAmountMinor,
        currency: request.input.currency,
        providerEventReference,
        verifiedAt: '2026-08-17T00:00:00.000Z',
      },
      externalReference: request.input.providerPaymentReference,
      evidenceReferences: [`payment-sandbox:${providerEventReference}`], retryable: false,
    };
  }

  private blocked(request: IntegrationRequest<PaymentVerificationInput>, reason: string): PaymentVerificationResponse {
    return {
      integrationId: this.integrationId, operation: request.operation, provider: this.provider, mode: request.mode, status: 'blocked',
      output: {
        providerPaymentReference: request.input.providerPaymentReference,
        commercialRecordReference: request.input.commercialRecordReference,
        verificationStatus: 'unknown',
      },
      evidenceReferences: [`payment-sandbox:blocked:${reason}`], retryable: false,
    };
  }
}
