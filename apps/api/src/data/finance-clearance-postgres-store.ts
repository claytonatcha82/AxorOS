import type { Pool } from 'pg';
import type { FinanceClearanceState } from '../agents/finance-clearance-gate.js';

export interface PersistedFinanceClearanceDecision {
  clearanceId: string;
  commercialRecordReference: string;
  providerPaymentReference: string;
  state: FinanceClearanceState;
  reason: string;
  evidenceReferences: string[];
  amountMinor: number;
  currency: string;
  verifiedAt: string;
}

export class FinanceClearanceIntegrityConflictError extends Error {
  constructor(clearanceId: string) {
    super(`Finance clearance integrity conflict for clearance ID ${clearanceId}.`);
    this.name = 'FinanceClearanceIntegrityConflictError';
  }
}

function parseEvidenceReferences(value: unknown): string[] {
  const parsed = typeof value === 'string' ? JSON.parse(value) as unknown : value;
  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === 'string' && item.length > 0)) {
    throw new Error('Persisted Finance clearance evidence is invalid.');
  }
  return parsed;
}

function normaliseTimestamp(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('Persisted Finance clearance verified_at is invalid.');
  }
  return parsed.toISOString();
}

function sameDecision(
  existing: PersistedFinanceClearanceDecision,
  incoming: PersistedFinanceClearanceDecision,
): boolean {
  return existing.clearanceId === incoming.clearanceId
    && existing.commercialRecordReference === incoming.commercialRecordReference
    && existing.providerPaymentReference === incoming.providerPaymentReference
    && existing.state === incoming.state
    && existing.reason === incoming.reason
    && existing.amountMinor === incoming.amountMinor
    && existing.currency === incoming.currency
    && normaliseTimestamp(existing.verifiedAt) === normaliseTimestamp(incoming.verifiedAt)
    && existing.evidenceReferences.length === incoming.evidenceReferences.length
    && existing.evidenceReferences.every((reference, index) => reference === incoming.evidenceReferences[index]);
}

export class FinanceClearancePostgresStore {
  constructor(private readonly pool: Pick<Pool, 'query'>) {}

  async save(decision: PersistedFinanceClearanceDecision): Promise<'accepted' | 'duplicate'> {
    const result = await this.pool.query(
      `insert into finance.clearance_decisions
         (clearance_id, commercial_record_reference, provider_payment_reference, state, reason,
          evidence_references, amount_minor, currency, verified_at)
       values ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9)
       on conflict (clearance_id) do nothing
       returning clearance_id`,
      [decision.clearanceId, decision.commercialRecordReference, decision.providerPaymentReference, decision.state,
       decision.reason, JSON.stringify(decision.evidenceReferences), decision.amountMinor, decision.currency, decision.verifiedAt],
    );

    if (result.rowCount === 1) return 'accepted';

    const existing = await this.get(decision.clearanceId);
    if (!existing || !sameDecision(existing, decision)) {
      throw new FinanceClearanceIntegrityConflictError(decision.clearanceId);
    }

    return 'duplicate';
  }

  async get(clearanceId: string): Promise<PersistedFinanceClearanceDecision | null> {
    const result = await this.pool.query(
      `select clearance_id, commercial_record_reference, provider_payment_reference, state, reason,
              evidence_references, amount_minor, currency, verified_at
       from finance.clearance_decisions where clearance_id = $1 limit 1`,
      [clearanceId],
    );
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      clearanceId: String(row.clearance_id),
      commercialRecordReference: String(row.commercial_record_reference),
      providerPaymentReference: String(row.provider_payment_reference),
      state: String(row.state) as FinanceClearanceState,
      reason: String(row.reason),
      evidenceReferences: parseEvidenceReferences(row.evidence_references),
      amountMinor: Number(row.amount_minor),
      currency: String(row.currency),
      verifiedAt: normaliseTimestamp(row.verified_at),
    };
  }
}
