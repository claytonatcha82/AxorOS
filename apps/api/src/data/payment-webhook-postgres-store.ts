import type { Pool } from 'pg';
import type { PaymentWebhookEvidence } from '../integrations/payment-webhook-evidence.js';

export class PaymentWebhookIntegrityConflictError extends Error {
  constructor(readonly idempotencyKey: string) {
    super(`Conflicting payment webhook evidence for idempotency key ${idempotencyKey}`);
    this.name = 'PaymentWebhookIntegrityConflictError';
  }
}

type PersistedPaymentWebhookEvidence = {
  provider: string;
  provider_event_reference: string;
  provider_payment_reference: string;
  event_type: string;
  commercial_record_reference: string;
  amount_minor: number | null;
  currency: string | null;
  occurred_at: string | Date;
  evidence_reference: string;
};

function normaliseTimestamp(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function isExactReplay(row: PersistedPaymentWebhookEvidence, evidence: PaymentWebhookEvidence): boolean {
  return row.provider === evidence.provider
    && row.provider_event_reference === evidence.providerEventReference
    && row.provider_payment_reference === evidence.providerPaymentReference
    && row.event_type === evidence.eventType
    && row.commercial_record_reference === evidence.commercialRecordReference
    && row.amount_minor === (evidence.amountMinor ?? null)
    && row.currency === (evidence.currency ?? null)
    && normaliseTimestamp(row.occurred_at) === normaliseTimestamp(evidence.occurredAt)
    && row.evidence_reference === evidence.evidenceReference;
}

export class PaymentWebhookPostgresStore {
  constructor(private readonly pool: Pick<Pool, 'query'>) {}

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

    const existing = await this.pool.query<PersistedPaymentWebhookEvidence>(
      `select provider, provider_event_reference, provider_payment_reference, event_type,
              commercial_record_reference, amount_minor, currency, occurred_at, evidence_reference
         from finance.payment_webhook_events
        where idempotency_key = $1
        limit 1`,
      [evidence.idempotencyKey],
    );
    const row = existing.rows[0];
    if (row && isExactReplay(row, evidence)) return 'duplicate';

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
