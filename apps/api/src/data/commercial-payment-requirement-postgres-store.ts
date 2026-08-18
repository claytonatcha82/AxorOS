import type { Pool } from 'pg';

export type CommercialPaymentGate = 'PRODUCTION_START' | 'MILESTONE_RELEASE' | 'FINAL_HANDOVER';
export type CommercialPaymentRequirementType = 'DEPOSIT' | 'MILESTONE' | 'FINAL' | 'APPROVED_ALTERNATIVE';
export type CommercialPaymentRequirementStatus = 'ACTIVE' | 'SATISFIED' | 'SUPERSEDED' | 'CANCELLED';

export interface PersistedCommercialPaymentRequirement {
  commercialRecordReference: string;
  gate: CommercialPaymentGate;
  requirementReference: string;
  requirementType: CommercialPaymentRequirementType;
  requiredAmountMinor: number;
  currency: string;
  status: CommercialPaymentRequirementStatus;
}

export class CommercialPaymentRequirementIntegrityConflictError extends Error {
  constructor(commercialRecordReference: string, gate: CommercialPaymentGate) {
    super(`Commercial payment requirement integrity conflict for ${commercialRecordReference}:${gate}.`);
    this.name = 'CommercialPaymentRequirementIntegrityConflictError';
  }
}

function rowToRequirement(row: Record<string, unknown>): PersistedCommercialPaymentRequirement {
  return {
    commercialRecordReference: String(row.commercial_record_reference),
    gate: String(row.gate) as CommercialPaymentGate,
    requirementReference: String(row.requirement_reference),
    requirementType: String(row.requirement_type) as CommercialPaymentRequirementType,
    requiredAmountMinor: Number(row.required_amount_minor),
    currency: String(row.currency),
    status: String(row.status) as CommercialPaymentRequirementStatus,
  };
}

function sameRequirement(
  existing: PersistedCommercialPaymentRequirement,
  incoming: PersistedCommercialPaymentRequirement,
): boolean {
  return existing.commercialRecordReference === incoming.commercialRecordReference
    && existing.gate === incoming.gate
    && existing.requirementReference === incoming.requirementReference
    && existing.requirementType === incoming.requirementType
    && existing.requiredAmountMinor === incoming.requiredAmountMinor
    && existing.currency === incoming.currency
    && existing.status === incoming.status;
}

export class CommercialPaymentRequirementPostgresStore {
  constructor(private readonly pool: Pick<Pool, 'query'>) {}

  async get(
    commercialRecordReference: string,
    gate: CommercialPaymentGate,
  ): Promise<PersistedCommercialPaymentRequirement | null> {
    const result = await this.pool.query(
      `select commercial_record_reference, gate, requirement_reference, requirement_type,
              required_amount_minor, currency, status
         from finance.commercial_payment_requirements
        where commercial_record_reference = $1 and gate = $2
        limit 1`,
      [commercialRecordReference, gate],
    );
    const row = result.rows[0] as Record<string, unknown> | undefined;
    return row ? rowToRequirement(row) : null;
  }

  async save(requirement: PersistedCommercialPaymentRequirement): Promise<'accepted' | 'duplicate'> {
    const result = await this.pool.query(
      `insert into finance.commercial_payment_requirements
         (commercial_record_reference, gate, requirement_reference, requirement_type,
          required_amount_minor, currency, status)
       values ($1,$2,$3,$4,$5,$6,$7)
       on conflict (commercial_record_reference, gate) do nothing
       returning commercial_record_reference`,
      [
        requirement.commercialRecordReference,
        requirement.gate,
        requirement.requirementReference,
        requirement.requirementType,
        requirement.requiredAmountMinor,
        requirement.currency,
        requirement.status,
      ],
    );

    if (result.rowCount === 1) return 'accepted';

    const existing = await this.get(requirement.commercialRecordReference, requirement.gate);
    if (!existing || !sameRequirement(existing, requirement)) {
      throw new CommercialPaymentRequirementIntegrityConflictError(
        requirement.commercialRecordReference,
        requirement.gate,
      );
    }
    return 'duplicate';
  }
}
