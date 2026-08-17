import type { Pool } from 'pg';
import type { PaymentWebhookEvidence } from '../integrations/payment-webhook-evidence.js';

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
    return result.rowCount === 1 ? 'accepted' : 'duplicate';
  }

  async hasProcessed(idempotencyKey: string): Promise<boolean> {
    const result = await this.pool.query(
      `select 1 from finance.payment_webhook_events where idempotency_key = $1 limit 1`,
      [idempotencyKey],
    );
    return (result.rowCount ?? 0) > 0;
  }
}
