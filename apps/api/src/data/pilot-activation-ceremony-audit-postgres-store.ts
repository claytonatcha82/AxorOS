import type { Pool } from 'pg';

export type PilotActivationCeremonyAction = 'PREVIEWED' | 'ACTIVATION_APPROVED' | 'DEACTIVATION_PROVED';

export interface PilotActivationCeremonyAuditRecord {
  auditId: string;
  readinessId: string;
  action: PilotActivationCeremonyAction;
  actor: 'human_executive';
  reason: string;
  evidenceReferences: string[];
  recordedAt: string;
}

export class PilotActivationCeremonyAuditIntegrityConflictError extends Error {
  constructor(auditId: string) {
    super(`Pilot activation ceremony audit integrity conflict for audit ID ${auditId}.`);
    this.name = 'PilotActivationCeremonyAuditIntegrityConflictError';
  }
}

function normalize(row: Record<string, unknown>): PilotActivationCeremonyAuditRecord {
  return {
    auditId: String(row.audit_id),
    readinessId: String(row.readiness_id),
    action: row.action as PilotActivationCeremonyAction,
    actor: 'human_executive',
    reason: String(row.reason),
    evidenceReferences: Array.isArray(row.evidence_references) ? row.evidence_references.map(String) : [],
    recordedAt: row.recorded_at instanceof Date ? row.recorded_at.toISOString() : new Date(String(row.recorded_at)).toISOString(),
  };
}

function canonical(record: PilotActivationCeremonyAuditRecord): string {
  return JSON.stringify({ ...record, evidenceReferences: [...record.evidenceReferences], recordedAt: new Date(record.recordedAt).toISOString() });
}

export class PilotActivationCeremonyAuditPostgresStore {
  constructor(private readonly pool: Pick<Pool, 'query'>) {}

  async get(auditId: string): Promise<PilotActivationCeremonyAuditRecord | null> {
    const result = await this.pool.query(
      `select audit_id, readiness_id, action, actor, reason, evidence_references, recorded_at
         from runtime.pilot_activation_ceremony_audit
        where audit_id = $1`,
      [auditId],
    );
    return result.rows[0] ? normalize(result.rows[0] as Record<string, unknown>) : null;
  }

  async save(record: PilotActivationCeremonyAuditRecord): Promise<'accepted' | 'replayed'> {
    if (!record.auditId.trim() || !record.readinessId.trim() || !record.reason.trim()) throw new Error('Pilot activation ceremony audit identifiers and reason are required.');
    if (!record.evidenceReferences.length || record.evidenceReferences.some((reference) => !reference.trim())) throw new Error('Pilot activation ceremony audit evidence is required.');
    if (Number.isNaN(Date.parse(record.recordedAt))) throw new Error('Pilot activation ceremony audit timestamp is invalid.');

    const inserted = await this.pool.query(
      `insert into runtime.pilot_activation_ceremony_audit
       (audit_id, readiness_id, action, actor, reason, evidence_references, recorded_at)
       values ($1,$2,$3,$4,$5,$6::jsonb,$7::timestamptz)
       on conflict (audit_id) do nothing`,
      [record.auditId, record.readinessId, record.action, record.actor, record.reason, JSON.stringify(record.evidenceReferences), record.recordedAt],
    );
    const persisted = await this.get(record.auditId);
    if (!persisted) throw new Error('Pilot activation ceremony audit could not be reloaded after persistence.');
    if (canonical(persisted) !== canonical(record)) throw new PilotActivationCeremonyAuditIntegrityConflictError(record.auditId);
    return inserted.rowCount === 1 ? 'accepted' : 'replayed';
  }
}
