import type { Pool } from 'pg';
import type { ProductionDeploymentGateInput } from '../agents/production-deployment-gate.js';

export interface ProductionDeploymentAuthorityRecord extends ProductionDeploymentGateInput {
  authorityId: string;
  commercialRecordReference: string;
  projectName: string;
  evidenceReferences: string[];
  approvedBy: string;
  approvedAt: string;
}

export class ProductionDeploymentAuthorityIntegrityConflictError extends Error {
  constructor(authorityId: string) {
    super(`Production deployment authority integrity conflict for authority ID ${authorityId}.`);
    this.name = 'ProductionDeploymentAuthorityIntegrityConflictError';
  }
}

function normalize(row: Record<string, unknown>): ProductionDeploymentAuthorityRecord {
  return {
    authorityId: String(row.authority_id),
    commercialRecordReference: String(row.commercial_record_reference),
    projectName: String(row.project_name),
    codeQaPassed: Boolean(row.code_qa_passed),
    functionalQaPassed: Boolean(row.functional_qa_passed),
    visualQaPassed: Boolean(row.visual_qa_passed),
    businessQaPassed: Boolean(row.business_qa_passed),
    clientApproved: Boolean(row.client_approved),
    requiredFinalPaymentConditionMet: Boolean(row.required_final_payment_condition_met),
    rollbackPrepared: Boolean(row.rollback_prepared),
    seoChecked: Boolean(row.seo_checked),
    securityChecked: Boolean(row.security_checked),
    deploymentApproved: Boolean(row.deployment_approved),
    evidenceReferences: Array.isArray(row.evidence_references) ? row.evidence_references.map(String) : [],
    approvedBy: String(row.approved_by),
    approvedAt: row.approved_at instanceof Date ? row.approved_at.toISOString() : new Date(String(row.approved_at)).toISOString(),
  };
}

function canonical(record: ProductionDeploymentAuthorityRecord): string {
  return JSON.stringify({
    ...record,
    evidenceReferences: [...record.evidenceReferences],
    approvedAt: new Date(record.approvedAt).toISOString(),
  });
}

export class ProductionDeploymentAuthorityPostgresStore {
  constructor(private readonly pool: Pick<Pool, 'query'>) {}

  async get(authorityId: string): Promise<ProductionDeploymentAuthorityRecord | null> {
    const result = await this.pool.query(
      `select authority_id, commercial_record_reference, project_name,
              code_qa_passed, functional_qa_passed, visual_qa_passed, business_qa_passed,
              client_approved, required_final_payment_condition_met, rollback_prepared,
              seo_checked, security_checked, deployment_approved,
              evidence_references, approved_by, approved_at
         from production.deployment_authorities
        where authority_id = $1`,
      [authorityId],
    );
    return result.rows[0] ? normalize(result.rows[0] as Record<string, unknown>) : null;
  }

  async save(record: ProductionDeploymentAuthorityRecord): Promise<'accepted' | 'replayed'> {
    if (!record.authorityId.trim()) throw new Error('Deployment authority ID is required.');
    if (!record.commercialRecordReference.trim()) throw new Error('Deployment authority commercial record is required.');
    if (!record.projectName.trim()) throw new Error('Deployment authority project name is required.');
    if (!record.approvedBy.trim()) throw new Error('Deployment authority approver is required.');
    if (Number.isNaN(Date.parse(record.approvedAt))) throw new Error('Deployment authority approval timestamp is invalid.');
    if (!record.evidenceReferences.length) throw new Error('Deployment authority evidence is required.');

    const inserted = await this.pool.query(
      `insert into production.deployment_authorities (
         authority_id, commercial_record_reference, project_name,
         code_qa_passed, functional_qa_passed, visual_qa_passed, business_qa_passed,
         client_approved, required_final_payment_condition_met, rollback_prepared,
         seo_checked, security_checked, deployment_approved,
         evidence_references, approved_by, approved_at
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16::timestamptz)
       on conflict (authority_id) do nothing`,
      [
        record.authorityId,
        record.commercialRecordReference,
        record.projectName,
        record.codeQaPassed,
        record.functionalQaPassed,
        record.visualQaPassed,
        record.businessQaPassed,
        record.clientApproved,
        record.requiredFinalPaymentConditionMet,
        record.rollbackPrepared,
        record.seoChecked,
        record.securityChecked,
        record.deploymentApproved,
        JSON.stringify(record.evidenceReferences),
        record.approvedBy,
        record.approvedAt,
      ],
    );

    const persisted = await this.get(record.authorityId);
    if (!persisted) throw new Error('Deployment authority record could not be reloaded after persistence.');
    if (canonical(persisted) !== canonical(record)) {
      throw new ProductionDeploymentAuthorityIntegrityConflictError(record.authorityId);
    }
    return inserted.rowCount === 1 ? 'accepted' : 'replayed';
  }
}
