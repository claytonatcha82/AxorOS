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
      if (input.disposition.disposition !== 'hold') {
        throw new Error('Lead qualification disposition persistence only accepts conservative hold dispositions.');
      }
      if (input.disposition.humanApprovalRequired !== true) {
        throw new Error('Lead qualification disposition must preserve human approval authority.');
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
          humanApprovalRequired: true,
          reasons: input.disposition.reasons,
          atlasSourcePaths: input.disposition.atlasSourcePaths,
        },
      });
    },
  };
}

export type LeadQualificationDispositionPersistenceService = ReturnType<typeof createLeadQualificationDispositionPersistenceService>;
