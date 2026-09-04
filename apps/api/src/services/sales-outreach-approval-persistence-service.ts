import type { OperationalRepository } from '../data/operational-repository.js';
import type { SalesOutreachApprovalRequest } from './sales-outreach-approval-service.js';

export interface PersistSalesOutreachApprovalInput {
  request: SalesOutreachApprovalRequest;
}

export function createSalesOutreachApprovalPersistenceService(
  repository: Pick<OperationalRepository, 'getLeadById' | 'createWorkflowEvent'>,
) {
  return {
    async persist(input: PersistSalesOutreachApprovalInput) {
      const request = input.request;
      if (request.atlasSourcePaths.length === 0) {
        throw new Error('Sales outreach approval persistence requires authoritative Atlas source paths.');
      }
      if (request.approvalRequired !== true || request.approvalOwner !== 'founder') {
        throw new Error('Sales outreach approval persistence requires founder approval.');
      }
      if (request.status !== 'pending_founder_approval') {
        throw new Error('Sales outreach approval request must be pending founder approval.');
      }
      if (request.outreachAuthorised !== false) {
        throw new Error('Sales outreach approval persistence must not authorise outreach.');
      }
      if (request.pricingAuthorised !== false) {
        throw new Error('Sales outreach approval persistence must not authorise pricing.');
      }
      if (request.commercialCommitmentAuthorised !== false) {
        throw new Error('Sales outreach approval persistence must not authorise commercial commitments.');
      }

      const lead = await repository.getLeadById(request.leadId);
      if (!lead) throw new Error(`Lead not found: ${request.leadId}.`);

      return repository.createWorkflowEvent({
        eventType: 'sales_outreach_approval_requested',
        actorType: 'agent',
        actorId: 'sales_agent',
        payload: {
          approvalRequestId: request.approvalRequestId,
          leadId: request.leadId,
          salesIntakeExecutionId: request.salesIntakeExecutionId,
          company: request.company,
          decision: request.decision,
          rationale: [...request.rationale],
          confidence: request.confidence,
          atlasSourcePaths: [...new Set(request.atlasSourcePaths)],
          approvalRequired: true,
          approvalOwner: 'founder',
          status: 'pending_founder_approval',
          outreachAuthorised: false,
          pricingAuthorised: false,
          commercialCommitmentAuthorised: false,
          nextAction: 'founder_approval_required',
        },
      });
    },
  };
}

export type SalesOutreachApprovalPersistenceService = ReturnType<
  typeof createSalesOutreachApprovalPersistenceService
>;
