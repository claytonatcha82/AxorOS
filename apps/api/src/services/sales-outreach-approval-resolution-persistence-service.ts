import type { OperationalRepository, WorkflowEventRecord } from '../data/operational-repository.js';
import type { SalesOutreachApprovalResolution } from './sales-outreach-approval-resolution-service.js';

export function createSalesOutreachApprovalResolutionPersistenceService(
  repository: Pick<OperationalRepository, 'findWorkflowEventByTypeAndPayloadField' | 'createWorkflowEvent'>,
) {
  return {
    async persist(input: { resolution: SalesOutreachApprovalResolution }): Promise<WorkflowEventRecord> {
      const resolution = input.resolution;
      if (resolution.atlasSourcePaths.length === 0) throw new Error('Sales founder approval resolution requires authoritative Atlas source paths.');
      if (resolution.actor !== 'founder') throw new Error('Sales founder approval resolution must be performed by founder.');
      if (resolution.pricingAuthorised !== false || resolution.commercialCommitmentAuthorised !== false) {
        throw new Error('Sales founder approval resolution must not authorise pricing or commercial commitment.');
      }
      if (resolution.decision === 'approved' && resolution.outreachAuthorised !== true) {
        throw new Error('Approved Sales founder approval must authorise outreach eligibility.');
      }
      if (resolution.decision === 'denied' && resolution.outreachAuthorised !== false) {
        throw new Error('Denied Sales founder approval must not authorise outreach.');
      }

      const existing = await repository.findWorkflowEventByTypeAndPayloadField(
        'sales_outreach_approval_resolved',
        'approvalRequestId',
        resolution.approvalRequestId,
      );
      if (existing) throw new Error(`Sales outreach approval ${resolution.approvalRequestId} has already been resolved.`);

      return repository.createWorkflowEvent({
        eventType: 'sales_outreach_approval_resolved',
        actorType: 'founder',
        actorId: 'founder',
        payload: {
          approvalRequestId: resolution.approvalRequestId,
          approvalRecordId: resolution.approvalRecordId,
          leadId: resolution.leadId,
          salesIntakeExecutionId: resolution.salesIntakeExecutionId,
          company: resolution.company,
          decision: resolution.decision,
          status: resolution.status,
          actor: resolution.actor,
          ...(resolution.reason ? { reason: resolution.reason } : {}),
          atlasSourcePaths: [...new Set(resolution.atlasSourcePaths)],
          outreachAuthorised: resolution.outreachAuthorised,
          pricingAuthorised: false,
          commercialCommitmentAuthorised: false,
          nextAction: resolution.nextAction,
        },
      });
    },
  };
}

export type SalesOutreachApprovalResolutionPersistenceService = ReturnType<
  typeof createSalesOutreachApprovalResolutionPersistenceService
>;
