import type { Pool } from 'pg';

export type OperationsProductionDeliveryReadinessState = 'DELIVERY_READY' | 'DELIVERY_BLOCKED';

export interface OperationsProductionDeliveryReadinessDecision {
  readinessId: string;
  commercialRecordReference: string;
  state: OperationsProductionDeliveryReadinessState;
  internalQaPassed: boolean;
  clientApproved: boolean;
  paymentConditionSatisfied: boolean;
  rollbackPrepared: boolean;
  seoChecked: boolean;
  securityChecked: boolean;
  deploymentApproved: boolean;
  evidenceReferences: string[];
  approvedBy: string;
  approvedAt: string;
}

export class OperationsProductionDeliveryReadinessIntegrityConflictError extends Error {
  constructor(readinessId: string) {
    super(`Operations production delivery readiness integrity conflict for readiness ID ${readinessId}.`);
    this.name = 'OperationsProductionDeliveryReadinessIntegrityConflictError';
  }
}

function normalize(row: Record<string, unknown>): OperationsProductionDeliveryReadinessDecision {
  const approvedAt = row.approved_at instanceof Date ? row.approved_at.toISOString() : String(row.approved_at);
  return {
    readinessId: String(row.readiness_id),
    commercialRecordReference: String(row.commercial_record_reference),
    state: row.state as OperationsProductionDeliveryReadinessState,
    internalQaPassed: Boolean(row.internal_qa_passed),
    clientApproved: Boolean(row.client_approved),
    paymentConditionSatisfied: Boolean(row.payment_condition_satisfied),
    rollbackPrepared: Boolean(row.rollback_prepared),
    seoChecked: Boolean(row.seo_checked),
    securityChecked: Boolean(row.security_checked),
    deploymentApproved: Boolean(row.deployment_approved),
    evidenceReferences: Array.isArray(row.evidence_references) ? row.evidence_references.map(String) : [],
    approvedBy: String(row.approved_by),
    approvedAt,
  };
}

function canonical(decision: OperationsProductionDeliveryReadinessDecision): string {
  return JSON.stringify({
    ...decision,
    evidenceReferences: [...decision.evidenceReferences],
    approvedAt: new Date(decision.approvedAt).toISOString(),
  });
}

export class OperationsProductionDeliveryReadinessPostgresStore {
  constructor(private readonly pool: Pick<Pool, 'query'>) {}

  async get(readinessId: string): Promise<OperationsProductionDeliveryReadinessDecision | null> {
    const result = await this.pool.query(
      `select readiness_id, commercial_record_reference, state,
              internal_qa_passed, client_approved, payment_condition_satisfied, rollback_prepared,
              seo_checked, security_checked, deployment_approved,
              evidence_references, approved_by, approved_at
         from operations.production_delivery_readiness_decisions
        where readiness_id = $1`,
      [readinessId],
    );
    return result.rows[0] ? normalize(result.rows[0] as Record<string, unknown>) : null;
  }

  async save(decision: OperationsProductionDeliveryReadinessDecision): Promise<'accepted' | 'replayed'> {
    if (!decision.readinessId.trim()) throw new Error('Production delivery readiness ID is required.');
    if (!decision.commercialRecordReference.trim()) throw new Error('Production delivery readiness commercial record is required.');
    if (!decision.approvedBy.trim()) throw new Error('Production delivery readiness approver is required.');
    if (Number.isNaN(Date.parse(decision.approvedAt))) throw new Error('Production delivery readiness approval timestamp is invalid.');
    if (!decision.evidenceReferences.length) throw new Error('Production delivery readiness evidence is required.');
    if (decision.state === 'DELIVERY_READY' && (
      !decision.internalQaPassed || !decision.clientApproved || !decision.paymentConditionSatisfied
      || !decision.rollbackPrepared || !decision.seoChecked || !decision.securityChecked || !decision.deploymentApproved
    )) {
      throw new Error('DELIVERY_READY requires QA, client approval, payment condition, rollback, SEO, security, and deployment approval.');
    }

    const inserted = await this.pool.query(
      `insert into operations.production_delivery_readiness_decisions (
         readiness_id, commercial_record_reference, state,
         internal_qa_passed, client_approved, payment_condition_satisfied, rollback_prepared,
         seo_checked, security_checked, deployment_approved,
         evidence_references, approved_by, approved_at
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13::timestamptz)
       on conflict (readiness_id) do nothing`,
      [
        decision.readinessId,
        decision.commercialRecordReference,
        decision.state,
        decision.internalQaPassed,
        decision.clientApproved,
        decision.paymentConditionSatisfied,
        decision.rollbackPrepared,
        decision.seoChecked,
        decision.securityChecked,
        decision.deploymentApproved,
        JSON.stringify(decision.evidenceReferences),
        decision.approvedBy,
        decision.approvedAt,
      ],
    );

    const persisted = await this.get(decision.readinessId);
    if (!persisted) throw new Error('Production delivery readiness record could not be reloaded after persistence.');
    if (canonical(persisted) !== canonical(decision)) {
      throw new OperationsProductionDeliveryReadinessIntegrityConflictError(decision.readinessId);
    }
    return inserted.rowCount === 1 ? 'accepted' : 'replayed';
  }
}
