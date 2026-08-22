import type { OperationalRepository } from '../data/operational-repository.js';
import type { SalesOpportunityAssessment } from './sales-opportunity-assessment-service.js';

export interface PersistSalesOpportunityAssessmentInput {
  assessment: SalesOpportunityAssessment;
}

function required(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${field} is required.`);
  return trimmed;
}

export function createSalesOpportunityAssessmentPersistenceService(
  repository: Pick<OperationalRepository, 'getLeadById' | 'createWorkflowEvent'>,
) {
  return {
    async persist(input: PersistSalesOpportunityAssessmentInput) {
      const assessment = input.assessment;
      const leadId = required(assessment.leadId, 'leadId');
      const salesIntakeExecutionId = required(assessment.salesIntakeExecutionId, 'salesIntakeExecutionId');

      if (assessment.atlasSourcePaths.length === 0) {
        throw new Error('Sales opportunity assessment persistence requires authoritative Atlas source paths.');
      }
      if (assessment.outreachAuthorised !== false) {
        throw new Error('Sales opportunity assessment persistence must not authorise outreach.');
      }
      if (assessment.pricingAuthorised !== false) {
        throw new Error('Sales opportunity assessment persistence must not authorise pricing.');
      }
      if (assessment.commercialCommitmentAuthorised !== false) {
        throw new Error('Sales opportunity assessment persistence must not authorise commercial commitments.');
      }

      const lead = await repository.getLeadById(leadId);
      if (!lead) throw new Error(`Lead not found: ${leadId}.`);

      return repository.createWorkflowEvent({
        eventType: 'sales_opportunity_assessment_recorded',
        actorType: 'agent',
        actorId: 'sales_agent',
        payload: {
          leadId,
          salesIntakeExecutionId,
          company: assessment.company,
          contactName: assessment.contactName,
          contactEmail: assessment.contactEmail,
          source: assessment.source,
          opportunitySummary: assessment.opportunitySummary,
          existingLeadScore: assessment.existingLeadScore,
          salesContext: assessment.salesContext,
          assessmentStatus: assessment.assessmentStatus,
          missingInformation: [...assessment.missingInformation],
          atlasSourcePaths: [...new Set(assessment.atlasSourcePaths)],
          outreachAuthorised: false,
          pricingAuthorised: false,
          commercialCommitmentAuthorised: false,
          nextAction: assessment.nextAction,
        },
      });
    },
  };
}

export type SalesOpportunityAssessmentPersistenceService = ReturnType<
  typeof createSalesOpportunityAssessmentPersistenceService
>;
