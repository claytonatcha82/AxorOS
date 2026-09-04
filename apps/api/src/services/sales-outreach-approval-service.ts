import type { SalesOpportunityDecisionResult } from './sales-opportunity-decision-service.js';

export type SalesOutreachApprovalStatus = 'pending_founder_approval';

export interface SalesOutreachApprovalRequest {
  approvalRequestId: string;
  leadId: string;
  salesIntakeExecutionId: string;
  company: string;
  decision: 'pursue';
  rationale: string[];
  confidence: number;
  atlasSourcePaths: string[];
  approvalRequired: true;
  approvalOwner: 'founder';
  status: SalesOutreachApprovalStatus;
  outreachAuthorised: false;
  pricingAuthorised: false;
  commercialCommitmentAuthorised: false;
  nextAction: 'founder_approval_required';
}

function required(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${field} is required.`);
  return trimmed;
}

export function createSalesOutreachApprovalService() {
  return {
    request(decision: SalesOpportunityDecisionResult): SalesOutreachApprovalRequest {
      if (decision.decision !== 'pursue') {
        throw new Error('Sales outreach approval can only be requested for a pursue decision.');
      }
      if (decision.atlasSourcePaths.length === 0) {
        throw new Error('Sales outreach approval requires authoritative Atlas source paths.');
      }
      if (decision.outreachAuthorised !== false) {
        throw new Error('Sales outreach approval request must start with outreach unauthorised.');
      }
      if (decision.pricingAuthorised !== false) {
        throw new Error('Sales outreach approval request must start with pricing unauthorised.');
      }
      if (decision.commercialCommitmentAuthorised !== false) {
        throw new Error('Sales outreach approval request must start with commercial commitment unauthorised.');
      }
      if (!Number.isFinite(decision.confidence) || decision.confidence < 0 || decision.confidence > 1) {
        throw new Error('Sales outreach approval requires confidence between 0 and 1.');
      }

      return {
        approvalRequestId: `sales-outreach-approval:${required(decision.salesIntakeExecutionId, 'salesIntakeExecutionId')}`,
        leadId: required(decision.leadId, 'leadId'),
        salesIntakeExecutionId: required(decision.salesIntakeExecutionId, 'salesIntakeExecutionId'),
        company: required(decision.company, 'company'),
        decision: 'pursue',
        rationale: [...decision.rationale],
        confidence: decision.confidence,
        atlasSourcePaths: [...new Set(decision.atlasSourcePaths)],
        approvalRequired: true,
        approvalOwner: 'founder',
        status: 'pending_founder_approval',
        outreachAuthorised: false,
        pricingAuthorised: false,
        commercialCommitmentAuthorised: false,
        nextAction: 'founder_approval_required',
      };
    },
  };
}

export type SalesOutreachApprovalService = ReturnType<typeof createSalesOutreachApprovalService>;
