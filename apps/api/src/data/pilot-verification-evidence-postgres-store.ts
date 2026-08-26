import type { Pool } from 'pg';

export type PilotVerificationCategory =
  | 'SYNTHETIC_LIFECYCLE'
  | 'PERSISTED_RUNTIME'
  | 'FINANCE_INTEGRITY'
  | 'CONTROL_PLANE'
  | 'DEPLOYMENT_SAFETY';

export type PilotVerificationOutcome = 'PASS' | 'FAIL';

export interface PilotVerificationEvidenceRecord {
  evidenceId: string;
  category: PilotVerificationCategory;
  outcome: PilotVerificationOutcome;
  verifier: string;
  sourceReference: string;
  details: Record<string, unknown>;
  verifiedAt: string;
}

export class PilotVerificationEvidenceIntegrityConflictError extends Error {
  constructor(evidenceId: string) {
    super(`Pilot verification evidence integrity conflict for evidence ID ${evidenceId}.`);
    this.name = 'PilotVerificationEvidenceIntegrityConflictError';
  }
}

function normalize(row: Record<string, unknown>): PilotVerificationEvidenceRecord {
  return {
    evidenceId: String(row.evidence_id),
    category: row.category as PilotVerificationCategory,
    outcome: row.outcome as PilotVerificationOutcome,
    verifier: String(row.verifier),
    sourceReference: String(row.source_reference),
    details: row.details && typeof row.details === 'object' && !Array.isArray(row.details)
      ? row.details as Record<string, unknown>
      : {},
    verifiedAt: row.verified_at instanceof Date
      ? row.verified_at.toISOString()
      : new Date(String(row.verified_at)).toISOString(),
  };
}

function canonical(record: PilotVerificationEvidenceRecord): string {
  return JSON.stringify({
    ...record,
    verifiedAt: new Date(record.verifiedAt).toISOString(),
  });
}

export class PilotVerificationEvidencePostgresStore {
  constructor(private readonly pool: Pick<Pool, 'query'>) {}

  async get(evidenceId: string): Promise<PilotVerificationEvidenceRecord | null> {
    const result = await this.pool.query(
      `select evidence_id, category, outcome, verifier, source_reference, details, verified_at
         from runtime.pilot_verification_evidence
        where evidence_id = $1`,
      [evidenceId],
    );
    return result.rows[0] ? normalize(result.rows[0] as Record<string, unknown>) : null;
  }

  async save(record: PilotVerificationEvidenceRecord): Promise<'accepted' | 'replayed'> {
    if (!record.evidenceId.trim()) throw new Error('Pilot verification evidence ID is required.');
    if (!record.verifier.trim()) throw new Error('Pilot verification verifier is required.');
    if (!record.sourceReference.trim()) throw new Error('Pilot verification source reference is required.');
    if (Number.isNaN(Date.parse(record.verifiedAt))) throw new Error('Pilot verification timestamp is invalid.');

    const inserted = await this.pool.query(
      `insert into runtime.pilot_verification_evidence (
         evidence_id, category, outcome, verifier, source_reference, details, verified_at
       ) values ($1,$2,$3,$4,$5,$6::jsonb,$7::timestamptz)
       on conflict (evidence_id) do nothing`,
      [
        record.evidenceId,
        record.category,
        record.outcome,
        record.verifier,
        record.sourceReference,
        JSON.stringify(record.details),
        record.verifiedAt,
      ],
    );

    const persisted = await this.get(record.evidenceId);
    if (!persisted) throw new Error('Pilot verification evidence could not be reloaded after persistence.');
    if (canonical(persisted) !== canonical(record)) {
      throw new PilotVerificationEvidenceIntegrityConflictError(record.evidenceId);
    }
    return inserted.rowCount === 1 ? 'accepted' : 'replayed';
  }
}
