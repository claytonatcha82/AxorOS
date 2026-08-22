import type { OperationalRepository } from '../data/operational-repository.js';

export interface SalesOutreachPreparationEligibility {
  eligible: true;
  assessmentRecordId: string;
  leadId: string;
  salesIntakeExecutionId: string;
  atlasSourcePaths: string[];
  preparationOnly: true;
  outreachAuthorised: false;
  sendAuthorised: false;
  pricingAuthorised: false;
  commercialCommitmentAuthorised: false;
  nextAction: 'prepare_internal_outreach_draft';
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required.`);
  return value.trim();
}

function requiredStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${field} is required.`);
  const normalized = value.map((entry) => requiredString(entry, field));
  return [...new Set(normalized)];
}

export function createSalesOutreachPreparationEligibilityService(
  repository: Pick<OperationalRepository, 'getWorkflowEventById'>,
) {
  return {
    async evaluate(assessmentRecordId: string): Promise<SalesOutreachPreparationEligibility> {
      const normalizedRecordId = assessmentRecordId.trim();
      if (!normalizedRecordId) throw new Error('assessmentRecordId is required.');

      const record = await repository.getWorkflowEventById(normalizedRecordId);
      if (!record) throw new Error(`Sales opportunity assessment record ${normalizedRecordId} was not found.`);
      if (record.eventType !== 'sales_opportunity_assessment_recorded') {
        throw new Error('Outreach preparation requires a persisted Sales opportunity assessment record.');
      }
      if (record.actorType !== 'agent' || record.actorId !== 'sales_agent') {
        throw new Error('Outreach preparation requires a Sales Agent assessment record.');
      }
      if (!record.payload || typeof record.payload !== 'object' || Array.isArray(record.payload)) {
        throw new Error('Sales opportunity assessment payload is invalid.');
      }

      const payload = record.payload as Record<string, unknown>;
      if (payload.assessmentStatus !== 'context_complete') {
        throw new Error('Outreach preparation requires a context-complete Sales opportunity assessment.');
      }
      if (!Array.isArray(payload.missingInformation) || payload.missingInformation.length !== 0) {
        throw new Error('Outreach preparation requires zero missing Sales context fields.');
      }
      if (payload.nextAction !== 'prepare_governed_sales_context') {
        throw new Error('Sales opportunity assessment is not ready for governed outreach preparation.');
      }
      if (payload.outreachAuthorised !== false || payload.pricingAuthorised !== false || payload.commercialCommitmentAuthorised !== false) {
        throw new Error('Outreach preparation eligibility must not inherit outreach, pricing, or commercial commitment authority.');
      }

      return {
        eligible: true,
        assessmentRecordId: record.id,
        leadId: requiredString(payload.leadId, 'leadId'),
        salesIntakeExecutionId: requiredString(payload.salesIntakeExecutionId, 'salesIntakeExecutionId'),
        atlasSourcePaths: requiredStringArray(payload.atlasSourcePaths, 'atlasSourcePaths'),
        preparationOnly: true,
        outreachAuthorised: false,
        sendAuthorised: false,
        pricingAuthorised: false,
        commercialCommitmentAuthorised: false,
        nextAction: 'prepare_internal_outreach_draft',
      };
    },
  };
}

export type SalesOutreachPreparationEligibilityService = ReturnType<
  typeof createSalesOutreachPreparationEligibilityService
>;
