import type { IntegrationRequest, IntegrationResponse } from './integration-contract.js';

export type PaymentIntegrationOperation = 'verify_payment';
export type PaymentVerificationStatus = 'verified_paid' | 'pending' | 'failed' | 'refunded' | 'unknown';

export interface PaymentVerificationInput {
  providerPaymentReference: string;
  expectedAmountMinor: number;
  currency: string;
  commercialRecordReference: string;
}

export interface PaymentVerificationOutput {
  providerPaymentReference: string;
  commercialRecordReference: string;
  verificationStatus: PaymentVerificationStatus;
  amountMinor?: number;
  currency?: string;
  providerEventReference?: string;
  verifiedAt?: string;
}

export type PaymentVerificationRequest = IntegrationRequest<PaymentVerificationInput> & {
  operation: PaymentIntegrationOperation;
};

export type PaymentVerificationResponse = IntegrationResponse<PaymentVerificationOutput>;

export function validatePaymentVerificationInput(input: PaymentVerificationInput): string[] {
  const errors: string[] = [];
  if (!input.providerPaymentReference.trim()) errors.push('providerPaymentReference is required.');
  if (!Number.isSafeInteger(input.expectedAmountMinor) || input.expectedAmountMinor <= 0) errors.push('expectedAmountMinor must be a positive safe integer.');
  if (!/^[A-Z]{3}$/.test(input.currency.trim())) errors.push('currency must be a three-letter uppercase ISO-style currency code.');
  if (!input.commercialRecordReference.trim()) errors.push('commercialRecordReference is required.');
  return errors;
}

export function hasVerifiedPaymentEvidence(response: PaymentVerificationResponse): boolean {
  const output = response.output;
  if (response.status !== 'succeeded') return false;
  if (output.verificationStatus !== 'verified_paid') return false;
  if (!output.providerPaymentReference.trim()) return false;
  if (!output.providerEventReference?.trim()) return false;
  if (!output.verifiedAt?.trim()) return false;
  if (!Number.isSafeInteger(output.amountMinor) || (output.amountMinor ?? 0) <= 0) return false;
  if (!output.currency || !/^[A-Z]{3}$/.test(output.currency)) return false;
  if (response.evidenceReferences.length === 0) return false;
  return true;
}
