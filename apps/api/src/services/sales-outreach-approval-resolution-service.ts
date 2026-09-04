import type { WorkflowEventRecord } from '../data/operational-repository.js';
import type { SalesOpportunityDecisionResult } from './sales-opportunity-decision-service.js';
import type { SalesOutreachApprovalRequest } from './sales-outreach-approval-service.js';

export type SalesOutreachApprovalResolutionDecision = 'approved' | 'denied';
export type SalesOutreachApprovalResolutionStatus = 'approved' | 'denied';

export interface SalesOutreachApprovalResolution {
  approvalRequestId: string;
  approvalRecordId: string;
  leadId: string;
  salesIntakeExecutionId: string;
  company: string;
  decision: SalesOutreachApprovalResolutionDecision;
  status: SalesOutreachApprovalResolutionStatus;
  actor: 'founder';
  reason?: string;
  atlasSourcePaths: string[];
  outreachAuthorised: boolean;
  pricingAuthorised: false;
  commercialCommitmentAuthorised: false;
  nextAction: 'prepare_governed_outreach' | 'hold_or_close_sales_opportunity';
}

function required(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${field} is required.`);
  return trimmed;
}

function payloadObject(record: WorkflowEventRecord): Record<string, unknown> {
  if (!record.payload || typeof record.payload !== 'object' || Array.isArray(record.payload)) {
    throw new Error('Founder approval record payload is invalid.');
  }
  return record.payload as Record<string, unknown>;
}

export function createSalesOutreachApprovalResolutionService() {
  return {
    resolve(input: {
      decision: SalesOpportunityDecisionResult;
      request: SalesOutreachApprovalRequest;
      approvalRecord: WorkflowEventRecord;
      actor: string;
      decisionOutcome: SalesOutreachApprovalResolutionDecision;
      reason?: string;
    }): SalesOutreachApprovalResolution {
      const { decision, request, approvalRecord } = input;
      if (input.actor !== 'founder') throw new Error('Sales outreach approval can only be resolved by founder.');
      if (decision.decision !== 'pursue') throw new Error('Sales outreach approval requires the original pursue decision.');
      if (decision.outreachAuthorised !== false) throw new Error('Original Sales decision must start with outreach unauthorised.');
      if (decision.pricingAuthorised !== false) throw new Error('Original Sales decision must start with pricing unauthorised.');
      if (decision.commercialCommitmentAuthorised !== false) throw new Error('Original Sales decision must start with commercial commitment unauthorised.');
      if (decision.atlasSourcePaths.length === 0) throw new Error('Sales outreach approval resolution requires authoritative Atlas source paths.');
      if (request.status !== 'pending_founder_approval') throw new Error('Sales outreach approval request is not pending founder approval.');
      if (request.approvalRequired !== true || request.approvalOwner !== 'founder') throw new Error('Sales outreach approval request is not governed by founder approval.');
      if (request.outreachAuthorised !== false || request.pricingAuthorised !== false || request.commercialCommitmentAuthorised !== false) {
        throw new Error('Pending Sales outreach approval must not contain authority.');
      }
      if (approvalRecord.eventType !== 'sales_outreach_approval_requested') throw new Error('Invalid Sales founder approval record type.');
      const payload = payloadObject(approvalRecord);
      if (payload.status !== 'pending_founder_approval') throw new Error('Sales founder approval record is not pending.');
      if (payload.approvalOwner !== 'founder' || payload.approvalRequired !== true) throw new Error('Sales founder approval record has invalid ownership or requirement.');
      if (payload.outreachAuthorised !== false || payload.pricingAuthorised !== false || payload.commercialCommitmentAuthorised !== false) throw new Error('Sales founder approval record must remain unauthorised before resolution.');
      if (required(String(payload.approvalRequestId ?? ''), 'approvalRequestId') !== request.approvalRequestId) throw new Error('Sales founder approval record does not match approval request.');
      if (required(String(payload.leadId ?? ''), 'leadId') !== decision.leadId || required(String(payload.salesIntakeExecutionId ?? ''), 'salesIntakeExecutionId') !== decision.salesIntakeExecutionId) {
        throw new Error('Sales founder approval record does not match the original Sales decision.');
      }
      if (request.leadId !== decision.leadId || request.salesIntakeExecutionId !== decision.salesIntakeExecutionId || request.company !== decision.company) {
        throw new Error('Sales approval request does not match the original Sales decision.');
      }
      const atlasSourcePaths = [...new Set(decision.atlasSourcePaths.map((path) => path.trim()).filter(Boolean))];
      if (atlasSourcePaths.length === 0) throw new Error('Sales outreach approval resolution requires non-empty Atlas source paths.');
      const reason = input.reason?.trim();

      if (input.decisionOutcome === 'approved') {
        return {
          approvalRequestId: request.approvalRequestId,
          approvalRecordId: required(approvalRecord.id, 'approvalRecordId'),
          leadId: decision.leadId,
          salesIntakeExecutionId: decision.salesIntakeExecutionId,
          company: decision.company,
          decision: 'approved',
          status: 'approved',
          actor: 'founder',
          ...(reason ? { reason } : {}),
          atlasSourcePaths,
          outreachAuthorised: true,
          pricingAuthorised: false,
          commercialCommitmentAuthorised: false,
          nextAction: 'prepare_governed_outreach',
        };
      }

      if (input.decisionOutcome !== 'denied') throw new Error('Sales founder approval resolution requires approved or denied.');
      return {
        approvalRequestId: request.approvalRequestId,
        approvalRecordId: required(approvalRecord.id, 'approvalRecordId'),
        leadId: decision.leadId,
        salesIntakeExecutionId: decision.salesIntakeExecutionId,
        company: decision.company,
        decision: 'denied',
        status: 'denied',
        actor: 'founder',
        ...(reason ? { reason } : {}),
        atlasSourcePaths,
        outreachAuthorised: false,
        pricingAuthorised: false,
        commercialCommitmentAuthorised: false,
        nextAction: 'hold_or_close_sales_opportunity',
      };
    },
  };
}

export type SalesOutreachApprovalResolutionService = ReturnType<typeof createSalesOutreachApprovalResolutionService>;
