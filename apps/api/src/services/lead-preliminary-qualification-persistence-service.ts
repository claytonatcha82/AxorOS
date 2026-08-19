import type { OperationalRepository } from '../data/operational-repository.js';
import type { QualificationCategoryAssessment, PreliminaryLeadQualificationResult } from './lead-preliminary-qualification-service.js';

export interface PersistPreliminaryQualificationInput {
  leadId: string;
  assessments: Record<string, QualificationCategoryAssessment>;
  result: PreliminaryLeadQualificationResult;
  actorId?: string;
}

export function createLeadPreliminaryQualificationPersistenceService(
  repository: Pick<OperationalRepository, 'getLeadById' | 'createPreliminaryLeadQualification' | 'createWorkflowEvent'>,
) {
  return {
    async persist(input: PersistPreliminaryQualificationInput) {
      const leadId = input.leadId.trim();
      if (!leadId) throw new Error('leadId is required.');
      const lead = await repository.getLeadById(leadId);
      if (!lead) throw new Error(`Lead not found: ${leadId}.`);
      if (input.result.humanReviewRequired !== true) {
        throw new Error('Preliminary Lead Agent qualification must require human review.');
      }

      const record = await repository.createPreliminaryLeadQualification({
        leadId,
        totalScore: input.result.totalScore,
        suggestedStatus: input.result.suggestedStatus,
        assessments: input.assessments,
        missingInformation: input.result.missingInformation,
        atlasSourcePaths: input.result.atlasSourcePaths,
        actorId: input.actorId?.trim() || 'lead_agent',
      });
      await repository.createWorkflowEvent({
        eventType: 'lead_preliminary_qualification_recorded',
        actorType: 'agent',
        actorId: input.actorId?.trim() || 'lead_agent',
        payload: {
          leadId,
          qualificationRecordId: record.id,
          suggestedStatus: record.suggestedStatus,
          totalScore: record.totalScore,
          humanReviewRequired: true,
          atlasSourcePaths: input.result.atlasSourcePaths,
        },
      });
      return record;
    },
  };
}

export type LeadPreliminaryQualificationPersistenceService = ReturnType<typeof createLeadPreliminaryQualificationPersistenceService>;
