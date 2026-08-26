import type { Pool } from 'pg';

export type PilotActivationReadinessState = 'PILOT_ACTIVATION_READY' | 'PILOT_ACTIVATION_BLOCKED';

export interface PilotActivationReadinessRecord {
  readinessId: string;
  state: PilotActivationReadinessState;
  syntheticLifecycleVerified: boolean;
  persistedRuntimeVerified: boolean;
  financeIntegrityVerified: boolean;
  controlPlaneVerified: boolean;
  deploymentSafetyVerified: boolean;
  evidenceReferences: string[];
  assessedBy: string;
  assessedAt: string;
}

export class PilotActivationReadinessIntegrityConflictError extends Error {
  constructor(readinessId: string) {
    super(`Pilot activation readiness integrity conflict for readiness ID ${readinessId}.`);
    this.name = 'PilotActivationReadinessIntegrityConflictError';
  }
}

function normalize(row: Record<string, unknown>): PilotActivationReadinessRecord {
  return {
    readinessId: String(row.readiness_id),
    state: row.state as PilotActivationReadinessState,
    syntheticLifecycleVerified: Boolean(row.synthetic_lifecycle_verified),
    persistedRuntimeVerified: Boolean(row.persisted_runtime_verified),
    financeIntegrityVerified: Boolean(row.finance_integrity_verified),
    controlPlaneVerified: Boolean(row.control_plane_verified),
    deploymentSafetyVerified: Boolean(row.deployment_safety_verified),
    evidenceReferences: Array.isArray(row.evidence_references) ? row.evidence_references.map(String) : [],
    assessedBy: String(row.assessed_by),
    assessedAt: row.assessed_at instanceof Date
      ? row.assessed_at.toISOString()
      : new Date(String(row.assessed_at)).toISOString(),
  };
}

function canonical(record: PilotActivationReadinessRecord): string {
  return JSON.stringify({
    ...record,
    evidenceReferences: [...record.evidenceReferences],
    assessedAt: new Date(record.assessedAt).toISOString(),
  });
}

function allActivationChecksPass(record: PilotActivationReadinessRecord): boolean {
  return record.syntheticLifecycleVerified
    && record.persistedRuntimeVerified
    && record.financeIntegrityVerified
    && record.controlPlaneVerified
    && record.deploymentSafetyVerified;
}

export class PilotActivationReadinessPostgresStore {
  constructor(private readonly pool: Pick<Pool, 'query'>) {}

  async get(readinessId: string): Promise<PilotActivationReadinessRecord | null> {
    const result = await this.pool.query(
      `select readiness_id, state,
              synthetic_lifecycle_verified, persisted_runtime_verified,
              finance_integrity_verified, control_plane_verified, deployment_safety_verified,
              evidence_references, assessed_by, assessed_at
         from runtime.pilot_activation_readiness
        where readiness_id = $1`,
      [readinessId],
    );
    return result.rows[0] ? normalize(result.rows[0] as Record<string, unknown>) : null;
  }

  async save(record: PilotActivationReadinessRecord): Promise<'accepted' | 'replayed'> {
    if (!record.readinessId.trim()) throw new Error('Pilot activation readiness ID is required.');
    if (!record.assessedBy.trim()) throw new Error('Pilot activation readiness assessor is required.');
    if (Number.isNaN(Date.parse(record.assessedAt))) throw new Error('Pilot activation readiness timestamp is invalid.');
    if (!record.evidenceReferences.length) throw new Error('Pilot activation readiness evidence is required.');
    if (record.evidenceReferences.some((reference) => !reference.trim())) {
      throw new Error('Pilot activation readiness evidence references must be non-empty.');
    }
    if (record.state === 'PILOT_ACTIVATION_READY' && !allActivationChecksPass(record)) {
      throw new Error('PILOT_ACTIVATION_READY requires every system verification gate to pass.');
    }

    const inserted = await this.pool.query(
      `insert into runtime.pilot_activation_readiness (
         readiness_id, state,
         synthetic_lifecycle_verified, persisted_runtime_verified,
         finance_integrity_verified, control_plane_verified, deployment_safety_verified,
         evidence_references, assessed_by, assessed_at
       ) values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10::timestamptz)
       on conflict (readiness_id) do nothing`,
      [
        record.readinessId,
        record.state,
        record.syntheticLifecycleVerified,
        record.persistedRuntimeVerified,
        record.financeIntegrityVerified,
        record.controlPlaneVerified,
        record.deploymentSafetyVerified,
        JSON.stringify(record.evidenceReferences),
        record.assessedBy,
        record.assessedAt,
      ],
    );

    const persisted = await this.get(record.readinessId);
    if (!persisted) throw new Error('Pilot activation readiness record could not be reloaded after persistence.');
    if (canonical(persisted) !== canonical(record)) {
      throw new PilotActivationReadinessIntegrityConflictError(record.readinessId);
    }
    return inserted.rowCount === 1 ? 'accepted' : 'replayed';
  }
}
