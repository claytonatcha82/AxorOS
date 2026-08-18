import { evaluateFinancePaymentLifecycle } from '../agents/finance-payment-lifecycle.js';
import type { PaymentWebhookEvidence, PaymentWebhookEventType } from '../integrations/payment-webhook-evidence.js';
import type { FinancePaymentAuthorityState } from '../agents/finance-payment-lifecycle.js';
import type { PaymentStatus } from '../agents/finance-state.js';

export interface PersistedFinancePaymentCurrentState {
  provider: string;
  providerPaymentReference: string;
  commercialRecordReference: string;
  paymentStatus: PaymentStatus;
  authorityState: FinancePaymentAuthorityState;
  reason: string;
  latestEventType: PaymentWebhookEventType;
  latestProviderEventReference: string;
  latestEvidenceReference: string;
  latestOccurredAt: string;
  amountMinor?: number;
  currency?: string;
}

export type FinancePaymentCurrentStateApplyResult = 'accepted' | 'duplicate' | 'stale';

export class FinancePaymentCurrentStateIntegrityConflictError extends Error {
  constructor(provider: string, providerPaymentReference: string) {
    super(`Finance payment current-state integrity conflict for ${provider}:${providerPaymentReference}.`);
    this.name = 'FinancePaymentCurrentStateIntegrityConflictError';
  }
}

interface Queryable {
  query(sql: string, params: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

function normaliseTimestamp(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return new Date(String(value)).toISOString();
}

function rowToState(row: Record<string, unknown>): PersistedFinancePaymentCurrentState {
  return {
    provider: String(row.provider),
    providerPaymentReference: String(row.provider_payment_reference),
    commercialRecordReference: String(row.commercial_record_reference),
    paymentStatus: String(row.payment_status) as PaymentStatus,
    authorityState: String(row.authority_state) as FinancePaymentAuthorityState,
    reason: String(row.reason),
    latestEventType: String(row.latest_event_type) as PaymentWebhookEventType,
    latestProviderEventReference: String(row.latest_provider_event_reference),
    latestEvidenceReference: String(row.latest_evidence_reference),
    latestOccurredAt: normaliseTimestamp(row.latest_occurred_at),
    ...(row.amount_minor === null || row.amount_minor === undefined ? {} : { amountMinor: Number(row.amount_minor) }),
    ...(row.currency === null || row.currency === undefined ? {} : { currency: String(row.currency) }),
  };
}

function sameMaterialState(a: PersistedFinancePaymentCurrentState, b: PersistedFinancePaymentCurrentState): boolean {
  return a.provider === b.provider
    && a.providerPaymentReference === b.providerPaymentReference
    && a.commercialRecordReference === b.commercialRecordReference
    && a.paymentStatus === b.paymentStatus
    && a.authorityState === b.authorityState
    && a.reason === b.reason
    && a.latestEventType === b.latestEventType
    && a.latestProviderEventReference === b.latestProviderEventReference
    && a.latestEvidenceReference === b.latestEvidenceReference
    && a.latestOccurredAt === b.latestOccurredAt
    && a.amountMinor === b.amountMinor
    && a.currency === b.currency;
}

export class FinancePaymentCurrentStatePostgresStore {
  constructor(private readonly database: Queryable) {}

  async get(provider: string, providerPaymentReference: string): Promise<PersistedFinancePaymentCurrentState | null> {
    const result = await this.database.query(
      `select provider, provider_payment_reference, commercial_record_reference, payment_status, authority_state,
              reason, latest_event_type, latest_provider_event_reference, latest_evidence_reference,
              latest_occurred_at, amount_minor, currency
         from finance.payment_current_state
        where provider = $1 and provider_payment_reference = $2`,
      [provider, providerPaymentReference],
    );
    return result.rows[0] ? rowToState(result.rows[0]) : null;
  }

  async apply(evidence: PaymentWebhookEvidence): Promise<FinancePaymentCurrentStateApplyResult> {
    const lifecycle = evaluateFinancePaymentLifecycle(evidence);
    const candidate: PersistedFinancePaymentCurrentState = {
      provider: evidence.provider,
      providerPaymentReference: evidence.providerPaymentReference,
      commercialRecordReference: evidence.commercialRecordReference,
      paymentStatus: lifecycle.paymentStatus,
      authorityState: lifecycle.authorityState,
      reason: lifecycle.reason,
      latestEventType: evidence.eventType,
      latestProviderEventReference: evidence.providerEventReference,
      latestEvidenceReference: evidence.evidenceReference,
      latestOccurredAt: lifecycle.occurredAt,
      ...(evidence.amountMinor !== undefined ? { amountMinor: evidence.amountMinor } : {}),
      ...(evidence.currency !== undefined ? { currency: evidence.currency } : {}),
    };

    const result = await this.database.query(
      `insert into finance.payment_current_state (
         provider, provider_payment_reference, commercial_record_reference, payment_status, authority_state,
         reason, latest_event_type, latest_provider_event_reference, latest_evidence_reference,
         latest_occurred_at, amount_minor, currency
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       on conflict (provider, provider_payment_reference) do update set
         commercial_record_reference = excluded.commercial_record_reference,
         payment_status = excluded.payment_status,
         authority_state = excluded.authority_state,
         reason = excluded.reason,
         latest_event_type = excluded.latest_event_type,
         latest_provider_event_reference = excluded.latest_provider_event_reference,
         latest_evidence_reference = excluded.latest_evidence_reference,
         latest_occurred_at = excluded.latest_occurred_at,
         amount_minor = excluded.amount_minor,
         currency = excluded.currency,
         updated_at = now()
       where excluded.latest_occurred_at > finance.payment_current_state.latest_occurred_at
       returning provider`,
      [
        candidate.provider,
        candidate.providerPaymentReference,
        candidate.commercialRecordReference,
        candidate.paymentStatus,
        candidate.authorityState,
        candidate.reason,
        candidate.latestEventType,
        candidate.latestProviderEventReference,
        candidate.latestEvidenceReference,
        candidate.latestOccurredAt,
        candidate.amountMinor ?? null,
        candidate.currency ?? null,
      ],
    );

    if (result.rows.length > 0) return 'accepted';

    const authoritative = await this.get(candidate.provider, candidate.providerPaymentReference);
    if (!authoritative) {
      throw new FinancePaymentCurrentStateIntegrityConflictError(candidate.provider, candidate.providerPaymentReference);
    }

    const candidateTime = Date.parse(candidate.latestOccurredAt);
    const authoritativeTime = Date.parse(authoritative.latestOccurredAt);
    if (candidateTime < authoritativeTime) return 'stale';
    if (candidateTime === authoritativeTime && sameMaterialState(authoritative, candidate)) return 'duplicate';

    throw new FinancePaymentCurrentStateIntegrityConflictError(candidate.provider, candidate.providerPaymentReference);
  }
}
