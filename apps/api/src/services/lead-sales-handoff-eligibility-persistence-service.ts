import type { OperationalRepository } from '../data/operational-repository.js';
import type { LeadSalesHandoffEligibility } from './lead-sales-handoff-eligibility-service.js';

export interface PersistLeadSalesHandoffEligibilityInput {
  eligibility: LeadSalesHandoffEligibility;
}

function required(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${field} is required.`);
  return trimmed;
}

export function createLeadSalesHandoffEligibilityPersistenceService(
  repository: Pick<OperationalRepository, 'getLeadById' | 'createWorkflowEvent'>,
) {
  return {
    async persist(input: PersistLeadSalesHandoffEligibilityInput) {
      if (input.eligibility.eligible !== true) {
        throw new Error('Lead to Sales handoff eligibility persistence requires an eligible decision.');
      }
      if (input.eligibility.recommendedAction !== 'approve_advance') {
        throw new Error('Lead to Sales handoff eligibility persistence requires approve_advance authority.');
      }
      if (input.eligibility.humanApprovalActor !== 'human_executive') {
        throw new Error('Lead to Sales handoff eligibility persistence requires recorded human executive approval.');
      }
      if (input.eligibility.atlasSourcePaths.length === 0) {
        throw new Error('Lead to Sales handoff eligibility persistence requires authoritative Atlas source paths.');
      }

      const leadId = required(input.eligibility.leadId, 'leadId');
      const qualificationRecordId = required(input.eligibility.qualificationRecordId, 'qualificationRecordId');
      const dispositionRecordId = required(input.eligibility.dispositionRecordId, 'dispositionRecordId');
      const reviewExecutionId = required(input.eligibility.reviewExecutionId, 'reviewExecutionId');
      const reviewTaskId = required(input.eligibility.reviewTaskId, 'reviewTaskId');

      const lead = await repository.getLeadById(leadId);
      if (!lead) throw new Error(`Lead not found: ${leadId}.`);

      return repository.createWorkflowEvent({
        eventType: 'lead_sales_handoff_eligibility_recorded',
        actorType: 'system',
        payload: {
          leadId,
          qualificationRecordId,
          dispositionRecordId,
          reviewExecutionId,
          reviewTaskId,
          eligible: true,
          recommendedAction: 'approve_advance',
          humanApprovalActor: 'human_executive',
          atlasSourcePaths: [...new Set(input.eligibility.atlasSourcePaths)],
          salesDispatchAuthorised: false,
          outreachAuthorised: false,
        },
      });
    },
  };
}

export type LeadSalesHandoffEligibilityPersistenceService = ReturnType<
  typeof createLeadSalesHandoffEligibilityPersistenceService
>;
