import type { OperationalRepository } from '../data/operational-repository.js';
import type { LeadQualificationDisposition } from './lead-qualification-disposition-service.js';

export interface PersistLeadQualificationDispositionInput {
  leadId: string;
  qualificationRecordId: string;
  disposition: LeadQualificationDisposition;
  actorId?: string;
}

export function createLeadQualificationDispositionPersistenceService(
  repository: Pick<OperationalRepository, 'getLeadById' | 'createWorkflowEvent'>,
) {
  return {
    async persist(input: PersistLeadQualificationDispositionInput) {
      const leadId = input.leadId.trim();
      if (!leadId) throw new Error('leadId is required.');
      const qualificationRecordId = input.qualificationRecordId.trim();
      if (!qualificationRecordId) throw new Error('qualificationRecordId is required.');
      const lead = await repository.getLeadById(leadId);
      if (!lead) throw new Error(`Lead not found: ${leadId}.`);

      const { disposition } = input.disposition;
      const isGovernedHold = disposition === 'hold'
        && input.disposition.humanApprovalRequired === true;
      const isGovernedAutoAdvance = disposition === 'advance'
        && input.disposition.humanApprovalRequired === false
        && input.disposition.recommendedAction === 'approve_advance';

      // The disposition service is the authority for whether the pilot threshold
      // permits auto-advance. Persistence must accept both governed outcomes rather
      // than silently blocking the valid advance disposition after it has been
      // evaluated. The persistence layer still fails closed on inconsistent state.
      if (!isGovernedHold && !isGovernedAutoAdvance) {
        throw new Error('Lead qualification disposition is not a governed hold or auto-advance disposition.');
      }
      if (input.disposition.atlasSourcePaths.length === 0) {
        throw new Error('Lead qualification disposition requires authoritative Atlas source paths.');
      }

      const actorId = input.actorId?.trim() || 'lead_agent';
      return repository.createWorkflowEvent({
        eventType: 'lead_qualification_disposition_recorded',
        actorType: 'agent',
        actorId,
        payload: {
          leadId,
          qualificationRecordId,
          disposition: input.disposition.disposition,
          recommendedAction: input.disposition.recommendedAction,
          humanApprovalRequired: input.disposition.humanApprovalRequired,
          reasons: input.disposition.reasons,
          atlasSourcePaths: input.disposition.atlasSourcePaths,
        },
      });
    },
  };
}

export type LeadQualificationDispositionPersistenceService = ReturnType<typeof createLeadQualificationDispositionPersistenceService>;
