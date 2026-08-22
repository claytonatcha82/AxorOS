import type { Pool } from 'pg';

export type OperationsProductionReadinessState = 'OPERATIONS_READY' | 'OPERATIONS_BLOCKED';

export interface OperationsProductionReadinessDecision {
  readinessId: string;
  commercialRecordReference: string;
  state: OperationsProductionReadinessState;
  contractSigned: boolean;
  onboardingComplete: boolean;
  assetsAvailable: boolean;
  planningComplete: boolean;
  evidenceReferences: string[];
  approvedBy: string;
  approvedAt: string;
}

export class OperationsProductionReadinessIntegrityConflictError extends Error {
  constructor(readinessId: string) {
    super(`Operations production readiness integrity conflict for readiness ID ${readinessId}.`);
    this.name = 'OperationsProductionReadinessIntegrityConflictError';
  }
}

function normalize(row: Record<string, unknown>): OperationsProductionReadinessDecision {
  const approvedAt = row.approved_at instanceof Date ? row.approved_at.toISOString() : String(row.approved_at);
  return {
    readinessId: String(row.readiness_id),
    commercialRecordReference: String(row.commercial_record_reference),
    state: row.state as OperationsProductionReadinessState,
    contractSigned: Boolean(row.contract_signed),
    onboardingComplete: Boolean(row.onboarding_complete),
    assetsAvailable: Boolean(row.assets_available),
    planningComplete: Boolean(row.planning_complete),
    evidenceReferences: Array.isArray(row.evidence_references) ? row.evidence_references.map(String) : [],
    approvedBy: String(row.approved_by),
    approvedAt,
  };
}

function canonical(decision: OperationsProductionReadinessDecision): string {
  return JSON.stringify({
    ...decision,
    evidenceReferences: [...decision.evidenceReferences],
    approvedAt: new Date(decision.approvedAt).toISOString(),
  });
}

export class OperationsProductionReadinessPostgresStore {
  constructor(private readonly pool: Pick<Pool, 'query'>) {}

  async get(readinessId: string): Promise<OperationsProductionReadinessDecision | null> {
    const result = await this.pool.query(
      `select readiness_id, commercial_record_reference, state,
              contract_signed, onboarding_complete, assets_available, planning_complete,
              evidence_references, approved_by, approved_at
         from operations.production_readiness_decisions
        where readiness_id = $1`,
      [readinessId],
    );
    return result.rows[0] ? normalize(result.rows[0] as Record<string, unknown>) : null;
  }

  async save(decision: OperationsProductionReadinessDecision): Promise<'accepted' | 'replayed'> {
    if (!decision.readinessId.trim()) throw new Error('Operations readiness ID is required.');
    if (!decision.commercialRecordReference.trim()) throw new Error('Operations readiness commercial record is required.');
    if (!decision.approvedBy.trim()) throw new Error('Operations readiness approver is required.');
    if (Number.isNaN(Date.parse(decision.approvedAt))) throw new Error('Operations readiness approval timestamp is invalid.');
    if (!decision.evidenceReferences.length) throw new Error('Operations readiness evidence is required.');
    if (decision.state === 'OPERATIONS_READY' && (!decision.contractSigned || !decision.onboardingComplete || !decision.assetsAvailable || !decision.planningComplete)) {
      throw new Error('OPERATIONS_READY requires contract, onboarding, assets, and planning completion.');
    }

    const inserted = await this.pool.query(
      `insert into operations.production_readiness_decisions (
         readiness_id, commercial_record_reference, state,
         contract_signed, onboarding_complete, assets_available, planning_complete,
         evidence_references, approved_by, approved_at
       ) values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10::timestamptz)
       on conflict (readiness_id) do nothing`,
      [
        decision.readinessId,
        decision.commercialRecordReference,
        decision.state,
        decision.contractSigned,
        decision.onboardingComplete,
        decision.assetsAvailable,
        decision.planningComplete,
        JSON.stringify(decision.evidenceReferences),
        decision.approvedBy,
        decision.approvedAt,
      ],
    );

    const persisted = await this.get(decision.readinessId);
    if (!persisted) throw new Error('Operations readiness record could not be reloaded after persistence.');
    if (canonical(persisted) !== canonical(decision)) {
      throw new OperationsProductionReadinessIntegrityConflictError(decision.readinessId);
    }
    return inserted.rowCount === 1 ? 'accepted' : 'replayed';
  }
}
