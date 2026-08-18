export type PaymentWebhookEventType =
  | 'payment_paid'
  | 'payment_pending'
  | 'payment_failed'
  | 'payment_refunded'
  | 'payment_reversed'
  | 'payment_disputed'
  | 'payment_chargeback'
  | 'unknown';

export interface PaymentWebhookEnvelope {
  provider: string;
  providerEventReference: string;
  providerPaymentReference: string;
  eventType: PaymentWebhookEventType;
  commercialRecordReference: string;
  amountMinor?: number;
  currency?: string;
  occurredAt: string;
  signatureVerified: boolean;
}

export interface PaymentWebhookEvidence {
  idempotencyKey: string;
  provider: string;
  providerEventReference: string;
  providerPaymentReference: string;
  eventType: PaymentWebhookEventType;
  commercialRecordReference: string;
  amountMinor?: number;
  currency?: string;
  occurredAt: string;
  evidenceReference: string;
}

export function validatePaymentWebhookEnvelope(event: PaymentWebhookEnvelope): string[] {
  const errors: string[] = [];
  if (!event.provider.trim()) errors.push('provider is required.');
  if (!event.providerEventReference.trim()) errors.push('providerEventReference is required.');
  if (!event.providerPaymentReference.trim()) errors.push('providerPaymentReference is required.');
  if (!event.commercialRecordReference.trim()) errors.push('commercialRecordReference is required.');
  if (!event.occurredAt.trim() || Number.isNaN(Date.parse(event.occurredAt))) errors.push('occurredAt must be a valid timestamp.');
  if (!event.signatureVerified) errors.push('provider webhook signature must be verified before ingestion.');
  if (event.amountMinor !== undefined && (!Number.isSafeInteger(event.amountMinor) || event.amountMinor <= 0)) errors.push('amountMinor must be a positive safe integer when supplied.');
  if (event.currency !== undefined && !/^[A-Z]{3}$/.test(event.currency)) errors.push('currency must be a three-letter uppercase ISO-style currency code when supplied.');
  return errors;
}

export function createPaymentWebhookEvidence(event: PaymentWebhookEnvelope): PaymentWebhookEvidence {
  const errors = validatePaymentWebhookEnvelope(event);
  if (errors.length > 0) throw new Error(errors.join(' '));
  return {
    idempotencyKey: `payment-webhook:${event.provider}:${event.providerEventReference}`,
    provider: event.provider,
    providerEventReference: event.providerEventReference,
    providerPaymentReference: event.providerPaymentReference,
    eventType: event.eventType,
    commercialRecordReference: event.commercialRecordReference,
    ...(event.amountMinor !== undefined ? { amountMinor: event.amountMinor } : {}),
    ...(event.currency !== undefined ? { currency: event.currency } : {}),
    occurredAt: event.occurredAt,
    evidenceReference: `payment-provider:${event.provider}:${event.providerEventReference}`,
  };
}

export class PaymentWebhookIdempotencyGuard {
  private readonly processed = new Set<string>();

  accept(evidence: PaymentWebhookEvidence): 'accepted' | 'duplicate' {
    if (this.processed.has(evidence.idempotencyKey)) return 'duplicate';
    this.processed.add(evidence.idempotencyKey);
    return 'accepted';
  }
}
