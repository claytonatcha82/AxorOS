import { createHmac, timingSafeEqual } from 'node:crypto';
import type { PaymentWebhookEnvelope, PaymentWebhookEventType } from './payment-webhook-evidence.js';

export interface PaystackWebhookAdapterDependencies {
  secretKey: string;
  resolveCommercialRecordReference?: (providerPaymentReference: string) => Promise<string | null>;
}

interface PaystackWebhookPayload {
  event?: unknown;
  data?: Record<string, unknown>;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function safePositiveInteger(value: unknown): number | undefined {
  const numeric = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : undefined;
}

function metadataObject(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function transactionObject(data: Record<string, unknown>): Record<string, unknown> | undefined {
  const transaction = data.transaction;
  return transaction && typeof transaction === 'object' && !Array.isArray(transaction)
    ? transaction as Record<string, unknown>
    : undefined;
}

function paymentReference(event: string, data: Record<string, unknown>): string | undefined {
  if (event.startsWith('refund.')) return nonEmptyString(data.transaction_reference) ?? nonEmptyString(transactionObject(data)?.reference);
  if (event.startsWith('charge.dispute.')) return nonEmptyString(transactionObject(data)?.reference) ?? nonEmptyString(data.transaction_reference);
  return nonEmptyString(data.reference) ?? nonEmptyString(transactionObject(data)?.reference);
}

function eventReference(event: string, data: Record<string, unknown>, providerPaymentReference: string): string {
  const entityReference = nonEmptyString(data.refund_reference)
    ?? nonEmptyString(data.reference)
    ?? nonEmptyString(data.id)
    ?? (safePositiveInteger(data.id)?.toString());
  return `${event}:${entityReference ?? providerPaymentReference}`;
}

function eventType(event: string): PaymentWebhookEventType {
  switch (event) {
    case 'charge.success': return 'payment_paid';
    case 'refund.pending':
    case 'refund.processing':
    case 'refund.needs-attention': return 'payment_pending';
    case 'refund.processed': return 'payment_refunded';
    case 'charge.dispute.create':
    case 'charge.dispute.remind': return 'payment_disputed';
    default: return 'unknown';
  }
}

function occurredAt(event: string, data: Record<string, unknown>): string {
  const candidates = event === 'charge.success'
    ? [data.paid_at, data.paidAt, data.transaction_date, data.created_at, data.createdAt]
    : [data.updated_at, data.updatedAt, data.created_at, data.createdAt, transactionObject(data)?.paid_at, transactionObject(data)?.paidAt];
  for (const candidate of candidates) {
    const value = nonEmptyString(candidate);
    if (value && !Number.isNaN(Date.parse(value))) return new Date(value).toISOString();
  }
  throw new Error('Paystack webhook does not contain a valid event timestamp.');
}

function amountMinor(data: Record<string, unknown>): number | undefined {
  return safePositiveInteger(data.amount) ?? safePositiveInteger(transactionObject(data)?.amount);
}

function currency(data: Record<string, unknown>): string | undefined {
  const value = nonEmptyString(data.currency) ?? nonEmptyString(transactionObject(data)?.currency);
  return value && /^[A-Z]{3}$/.test(value) ? value : undefined;
}

function metadataCommercialRecordReference(data: Record<string, unknown>): string | undefined {
  const metadata = metadataObject(data.metadata) ?? metadataObject(transactionObject(data)?.metadata);
  return nonEmptyString(metadata?.axorosCommercialRecordReference)
    ?? nonEmptyString(metadata?.commercialRecordReference);
}

export function verifyPaystackWebhookSignature(input: {
  rawBody: string | Buffer;
  signature: string | undefined;
  secretKey: string;
}): boolean {
  const supplied = input.signature?.trim().toLowerCase();
  if (!supplied || !/^[a-f0-9]{128}$/.test(supplied)) return false;
  const expected = createHmac('sha512', input.secretKey).update(input.rawBody).digest('hex');
  const suppliedBuffer = Buffer.from(supplied, 'hex');
  const expectedBuffer = Buffer.from(expected, 'hex');
  return suppliedBuffer.length === expectedBuffer.length && timingSafeEqual(suppliedBuffer, expectedBuffer);
}

export async function createPaystackWebhookEnvelope(
  dependencies: PaystackWebhookAdapterDependencies,
  input: { rawBody: string | Buffer; signature: string | undefined },
): Promise<PaymentWebhookEnvelope> {
  if (!verifyPaystackWebhookSignature({ ...input, secretKey: dependencies.secretKey })) {
    throw new Error('Paystack webhook signature verification failed.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.isBuffer(input.rawBody) ? input.rawBody.toString('utf8') : input.rawBody) as unknown;
  } catch {
    throw new Error('Paystack webhook payload is not valid JSON.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Paystack webhook payload must be an object.');

  const payload = parsed as PaystackWebhookPayload;
  const event = nonEmptyString(payload.event);
  const data = payload.data;
  if (!event || !data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Paystack webhook event and data are required.');

  const providerPaymentReference = paymentReference(event, data);
  if (!providerPaymentReference) throw new Error('Paystack webhook transaction reference is required.');

  const commercialRecordReference = metadataCommercialRecordReference(data)
    ?? await dependencies.resolveCommercialRecordReference?.(providerPaymentReference)
    ?? undefined;
  if (!commercialRecordReference) {
    throw new Error('Paystack webhook could not resolve the AxorOS commercial record reference.');
  }

  const normalizedAmount = amountMinor(data);
  const normalizedCurrency = currency(data);
  return {
    provider: 'paystack',
    providerEventReference: eventReference(event, data, providerPaymentReference),
    providerPaymentReference,
    eventType: eventType(event),
    commercialRecordReference,
    ...(normalizedAmount !== undefined ? { amountMinor: normalizedAmount } : {}),
    ...(normalizedCurrency !== undefined ? { currency: normalizedCurrency } : {}),
    occurredAt: occurredAt(event, data),
    signatureVerified: true,
  };
}
