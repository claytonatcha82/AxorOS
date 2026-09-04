import type { OperationalRepository } from '../data/operational-repository.js';
import type { SalesOpportunityDecisionResult } from './sales-opportunity-decision-service.js';

export interface PersistSalesOpportunityDecisionInput {
  decision: SalesOpportunityDecisionResult;
}

function required(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${field} is required.`);
  return trimmed;
}

export function createSalesOpportunityDecisionPersistenceService(
  repository: Pick<OperationalRepository, 'getLeadById' | 'createWorkflowEvent'>,
) {
  return {
    async persist(input: PersistSalesOpportunityDecisionInput) {
      const decision = input.decision;
      const leadId = required(decision.leadId, 'leadId');
      const salesIntakeExecutionId = required(decision.salesIntakeExecutionId, 'salesIntakeExecutionId');

      if (decision.atlasSourcePaths.length === 0) {
        throw new Error('Sales opportunity decision persistence requires authoritative Atlas source paths.');
      }
      if (decision.outreachAuthorised !== false) {
        throw new Error('Sales opportunity decision persistence must not authorise outreach.');
      }
      if (decision.pricingAuthorised !== false) {
        throw new Error('Sales opportunity decision persistence must not authorise pricing.');
      }
      if (decision.commercialCommitmentAuthorised !== false) {
        throw new Error('Sales opportunity decision persistence must not authorise commercial commitments.');
      }
      if (!Number.isFinite(decision.confidence) || decision.confidence < 0 || decision.confidence > 1) {
        throw new Error('Sales opportunity decision persistence requires confidence between 0 and 1.');
      }

      const lead = await repository.getLeadById(leadId);
      if (!lead) throw new Error(`Lead not found: ${leadId}.`);

      return repository.createWorkflowEvent({
        eventType: 'sales_opportunity_decision_recorded',
        actorType: 'agent',
        actorId: 'sales_agent',
        payload: {
          leadId,
          salesIntakeExecutionId,
          company: decision.company,
          decision: decision.decision,
          rationale: [...decision.rationale],
          missingInformation: [...decision.missingInformation],
          confidence: decision.confidence,
          recommendedNextAction: decision.recommendedNextAction,
          atlasSourcePaths: [...new Set(decision.atlasSourcePaths)],
          outreachAuthorised: false,
          pricingAuthorised: false,
          commercialCommitmentAuthorised: false,
        },
      });
    },
  };
}

export type SalesOpportunityDecisionPersistenceService = ReturnType<
  typeof createSalesOpportunityDecisionPersistenceService
>;
