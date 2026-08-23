import type { IntegrationRequest, IntegrationResponse } from './integration-contract.js';

export interface PaymentRequestInitializationInput {
  commercialRecordReference: string;
  requirementReference: string;
  providerPaymentReference: string;
  recipientEmail: string;
  amountMinor: number;
  currency: string;
}

export interface PaymentRequestInitializationOutput {
  commercialRecordReference: string;
  requirementReference: string;
  providerPaymentReference: string;
  authorizationUrl?: string;
  accessCode?: string;
}

export type PaymentRequestInitializationRequest = IntegrationRequest<PaymentRequestInitializationInput> & {
  operation: 'initialize_payment_request';
};

export type PaymentRequestInitializationResponse = IntegrationResponse<PaymentRequestInitializationOutput>;

export function validatePaymentRequestInitializationInput(input: PaymentRequestInitializationInput): string[] {
  const errors: string[] = [];
  if (!input.commercialRecordReference.trim()) errors.push('commercialRecordReference is required.');
  if (!input.requirementReference.trim()) errors.push('requirementReference is required.');
  if (!input.providerPaymentReference.trim()) errors.push('providerPaymentReference is required.');
  if (!/^\S+@\S+\.\S+$/.test(input.recipientEmail.trim())) errors.push('recipientEmail must be a valid email address.');
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) errors.push('amountMinor must be a positive safe integer.');
  if (!/^[A-Z]{3}$/.test(input.currency.trim())) errors.push('currency must be a three-letter uppercase ISO-style currency code.');
  return errors;
}

export function hasUsablePaymentRequest(response: PaymentRequestInitializationResponse): boolean {
  if (response.status !== 'succeeded') return false;
  if (!response.output.providerPaymentReference.trim()) return false;
  if (!response.output.authorizationUrl?.trim()) return false;
  if (!response.output.accessCode?.trim()) return false;
  if (response.evidenceReferences.length === 0) return false;
  return true;
}
