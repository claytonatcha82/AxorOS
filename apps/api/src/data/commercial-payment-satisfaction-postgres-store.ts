import type { Pool } from 'pg';
import type { CommercialPaymentGate } from './commercial-payment-requirement-postgres-store.js';

export interface PersistedCommercialPaymentSatisfaction {
  requirementReference: string;
  clearanceId: string;
  commercialRecordReference: string;
  gate: CommercialPaymentGate;
  satisfiedAt: string;
}

export class CommercialPaymentSatisfactionIntegrityConflictError extends Error {
  constructor(requirementReference: string) {
    super(`Commercial payment satisfaction integrity conflict for ${requirementReference}.`);
    this.name = 'CommercialPaymentSatisfactionIntegrityConflictError';
  }
}

function normaliseTimestamp(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) throw new Error('Persisted commercial payment satisfaction timestamp is invalid.');
  return parsed.toISOString();
}

function rowToSatisfaction(row: Record<string, unknown>): PersistedCommercialPaymentSatisfaction {
  return {
    requirementReference: String(row.requirement_reference),
    clearanceId: String(row.clearance_id),
    commercialRecordReference: String(row.commercial_record_reference),
    gate: String(row.gate) as CommercialPaymentGate,
    satisfiedAt: normaliseTimestamp(row.satisfied_at),
  };
}

function sameSatisfaction(a: PersistedCommercialPaymentSatisfaction, b: PersistedCommercialPaymentSatisfaction): boolean {
  return a.requirementReference === b.requirementReference
    && a.clearanceId === b.clearanceId
    && a.commercialRecordReference === b.commercialRecordReference
    && a.gate === b.gate
    && normaliseTimestamp(a.satisfiedAt) === normaliseTimestamp(b.satisfiedAt);
}

export class CommercialPaymentSatisfactionPostgresStore {
  constructor(private readonly pool: Pick<Pool, 'query'>) {}

  async get(requirementReference: string): Promise<PersistedCommercialPaymentSatisfaction | null> {
    const result = await this.pool.query(
      `select requirement_reference, clearance_id, commercial_record_reference, gate, satisfied_at
         from finance.commercial_payment_satisfactions
        where requirement_reference = $1
        limit 1`,
      [requirementReference],
    );
    const row = result.rows[0] as Record<string, unknown> | undefined;
    return row ? rowToSatisfaction(row) : null;
  }

  async save(satisfaction: PersistedCommercialPaymentSatisfaction): Promise<'accepted' | 'duplicate'> {
    const result = await this.pool.query(
      `insert into finance.commercial_payment_satisfactions
         (requirement_reference, clearance_id, commercial_record_reference, gate, satisfied_at)
       values ($1,$2,$3,$4,$5)
       on conflict (requirement_reference) do nothing
       returning requirement_reference`,
      [
        satisfaction.requirementReference,
        satisfaction.clearanceId,
        satisfaction.commercialRecordReference,
        satisfaction.gate,
        satisfaction.satisfiedAt,
      ],
    );
    if (result.rowCount === 1) return 'accepted';

    const existing = await this.get(satisfaction.requirementReference);
    if (!existing || !sameSatisfaction(existing, satisfaction)) {
      throw new CommercialPaymentSatisfactionIntegrityConflictError(satisfaction.requirementReference);
    }
    return 'duplicate';
  }
}
