import type { Pool } from 'pg';

export interface PersistedFinancePaymentRequest {
  requirementReference: string;
  commercialRecordReference: string;
  provider: string;
  providerPaymentReference: string;
  authorizationUrl: string;
  amountMinor: number;
  currency: string;
  evidenceReferences: string[];
  createdAt: string;
}

export class FinancePaymentRequestIntegrityConflictError extends Error {
  constructor(requirementReference: string) {
    super(`Finance payment request integrity conflict for requirement ${requirementReference}.`);
    this.name = 'FinancePaymentRequestIntegrityConflictError';
  }
}

function parseEvidenceReferences(value: unknown): string[] {
  const parsed = typeof value === 'string' ? JSON.parse(value) as unknown : value;
  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === 'string' && item.length > 0)) {
    throw new Error('Persisted Finance payment request evidence is invalid.');
  }
  return parsed;
}

function normaliseTimestamp(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) throw new Error('Persisted Finance payment request created_at is invalid.');
  return parsed.toISOString();
}

function sameRequest(existing: PersistedFinancePaymentRequest, incoming: PersistedFinancePaymentRequest): boolean {
  return existing.requirementReference === incoming.requirementReference
    && existing.commercialRecordReference === incoming.commercialRecordReference
    && existing.provider === incoming.provider
    && existing.providerPaymentReference === incoming.providerPaymentReference
    && existing.authorizationUrl === incoming.authorizationUrl
    && existing.amountMinor === incoming.amountMinor
    && existing.currency === incoming.currency
    && existing.evidenceReferences.length === incoming.evidenceReferences.length
    && existing.evidenceReferences.every((reference, index) => reference === incoming.evidenceReferences[index]);
}

export class FinancePaymentRequestPostgresStore {
  constructor(private readonly pool: Pick<Pool, 'query'>) {}

  async get(requirementReference: string): Promise<PersistedFinancePaymentRequest | null> {
    const result = await this.pool.query(
      `select requirement_reference, commercial_record_reference, provider, provider_payment_reference,
              authorization_url, amount_minor, currency, evidence_references, created_at
         from finance.payment_requests
        where requirement_reference = $1
        limit 1`,
      [requirementReference],
    );
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      requirementReference: String(row.requirement_reference),
      commercialRecordReference: String(row.commercial_record_reference),
      provider: String(row.provider),
      providerPaymentReference: String(row.provider_payment_reference),
      authorizationUrl: String(row.authorization_url),
      amountMinor: Number(row.amount_minor),
      currency: String(row.currency),
      evidenceReferences: parseEvidenceReferences(row.evidence_references),
      createdAt: normaliseTimestamp(row.created_at),
    };
  }

  async save(request: PersistedFinancePaymentRequest): Promise<'accepted' | 'duplicate'> {
    const result = await this.pool.query(
      `insert into finance.payment_requests
         (requirement_reference, commercial_record_reference, provider, provider_payment_reference,
          authorization_url, amount_minor, currency, evidence_references, created_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)
       on conflict (requirement_reference) do nothing
       returning requirement_reference`,
      [request.requirementReference, request.commercialRecordReference, request.provider,
       request.providerPaymentReference, request.authorizationUrl, request.amountMinor, request.currency,
       JSON.stringify(request.evidenceReferences), request.createdAt],
    );
    if (result.rowCount === 1) return 'accepted';
    const existing = await this.get(request.requirementReference);
    if (!existing || !sameRequest(existing, request)) {
      throw new FinancePaymentRequestIntegrityConflictError(request.requirementReference);
    }
    return 'duplicate';
  }
}
