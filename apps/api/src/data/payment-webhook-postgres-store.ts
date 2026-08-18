import type { Pool } from 'pg';
import type { PaymentWebhookEvidence } from '../integrations/payment-webhook-evidence.js';

export class PaymentWebhookIntegrityConflictError extends Error {
  constructor(readonly idempotencyKey: string) {
    super(`Conflicting payment webhook evidence for idempotency key ${idempotencyKey}`);
    this.name = 'PaymentWebhookIntegrityConflictError';
  }
}

type PersistedPaymentWebhookEvidence = {
  idempotency_key: string;
  provider: string;
  provider_event_reference: string;
  provider_payment_reference: string;
  event_type: PaymentWebhookEvidence['eventType'];
  commercial_record_reference: string;
  amount_minor: number | null;
  currency: string | null;
  occurred_at: string | Date;
  evidence_reference: string;
};

function normaliseTimestamp(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function rowToEvidence(row: PersistedPaymentWebhookEvidence): PaymentWebhookEvidence {
  return {
    idempotencyKey: row.idempotency_key,
    provider: row.provider,
    providerEventReference: row.provider_event_reference,
    providerPaymentReference: row.provider_payment_reference,
    eventType: row.event_type,
    commercialRecordReference: row.commercial_record_reference,
    ...(row.amount_minor === null ? {} : { amountMinor: Number(row.amount_minor) }),
    ...(row.currency === null ? {} : { currency: row.currency }),
    occurredAt: normaliseTimestamp(row.occurred_at),
    evidenceReference: row.evidence_reference,
  };
}

function isExactReplay(existing: PaymentWebhookEvidence, evidence: PaymentWebhookEvidence): boolean {
  return existing.idempotencyKey === evidence.idempotencyKey
    && existing.provider === evidence.provider
    && existing.providerEventReference === evidence.providerEventReference
    && existing.providerPaymentReference === evidence.providerPaymentReference
    && existing.eventType === evidence.eventType
    && existing.commercialRecordReference === evidence.commercialRecordReference
    && existing.amountMinor === evidence.amountMinor
    && existing.currency === evidence.currency
    && normaliseTimestamp(existing.occurredAt) === normaliseTimestamp(evidence.occurredAt)
    && existing.evidenceReference === evidence.evidenceReference;
}

export class PaymentWebhookPostgresStore {
  constructor(private readonly pool: Pick<Pool, 'query'>) {}

  async get(idempotencyKey: string): Promise<PaymentWebhookEvidence | null> {
    const result = await this.pool.query<PersistedPaymentWebhookEvidence>(
      `select idempotency_key, provider, provider_event_reference, provider_payment_reference, event_type,
              commercial_record_reference, amount_minor, currency, occurred_at, evidence_reference
         from finance.payment_webhook_events
        where idempotency_key = $1
        limit 1`,
      [idempotencyKey],
    );
    return result.rows[0] ? rowToEvidence(result.rows[0]) : null;
  }

  async save(evidence: PaymentWebhookEvidence): Promise<'accepted' | 'duplicate'> {
    const result = await this.pool.query(
      `insert into finance.payment_webhook_events
         (idempotency_key, provider, provider_event_reference, provider_payment_reference, event_type,
          commercial_record_reference, amount_minor, currency, occurred_at, evidence_reference)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       on conflict do nothing
       returning id`,
      [
        evidence.idempotencyKey,
        evidence.provider,
        evidence.providerEventReference,
        evidence.providerPaymentReference,
        evidence.eventType,
        evidence.commercialRecordReference,
        evidence.amountMinor ?? null,
        evidence.currency ?? null,
        evidence.occurredAt,
        evidence.evidenceReference,
      ],
    );

    if (result.rowCount === 1) return 'accepted';

    const existing = await this.get(evidence.idempotencyKey);
    if (existing && isExactReplay(existing, evidence)) return 'duplicate';

    throw new PaymentWebhookIntegrityConflictError(evidence.idempotencyKey);
  }

  async hasProcessed(idempotencyKey: string): Promise<boolean> {
    const result = await this.pool.query(
      `select 1 from finance.payment_webhook_events where idempotency_key = $1 limit 1`,
      [idempotencyKey],
    );
    return (result.rowCount ?? 0) > 0;
  }
}
