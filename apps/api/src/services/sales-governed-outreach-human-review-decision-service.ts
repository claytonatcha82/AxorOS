import type { OperationalRepository, WorkflowEventRecord } from '../data/operational-repository.js';

export type SalesGovernedOutreachHumanReviewDecision = 'approved' | 'denied';

export interface SalesGovernedOutreachHumanReviewDecisionResult {
  reviewRequestRecordId: string;
  preparationRecordId: string;
  resolutionRecordId: string;
  decision: SalesGovernedOutreachHumanReviewDecision;
  reviewer: 'human_executive';
  reviewComplete: true;
  preparationOnly: true;
  outreachAuthorised: false;
  dispatchAuthorised: false;
  sendAuthorised: false;
  pricingAuthorised: false;
  commercialCommitmentAuthorised: false;
  nextAction: 'prepare_supervised_send_gate' | 'hold_governed_outreach_preparation';
  reason?: string;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required.`);
  return value.trim();
}

function payloadObject(record: WorkflowEventRecord, label: string): Record<string, unknown> {
  if (!record.payload || typeof record.payload !== 'object' || Array.isArray(record.payload)) {
    throw new Error(`${label} payload is invalid.`);
  }
  return record.payload as Record<string, unknown>;
}

export function createSalesGovernedOutreachHumanReviewDecisionService(
  repository: Pick<OperationalRepository, 'getWorkflowEventById' | 'findWorkflowEventByTypeAndPayloadField' | 'createWorkflowEvent'>,
) {
  return {
    async decide(input: {
      reviewRequestRecordId: string;
      decision: SalesGovernedOutreachHumanReviewDecision;
      reviewer: string;
      reason?: string;
    }): Promise<{
      decision: SalesGovernedOutreachHumanReviewDecisionResult;
      record: WorkflowEventRecord;
    }> {
      const reviewRequestRecordId = requiredString(input.reviewRequestRecordId, 'reviewRequestRecordId');
      if (input.decision !== 'approved' && input.decision !== 'denied') {
        throw new Error('decision must be approved or denied.');
      }
      const reviewer = requiredString(input.reviewer, 'reviewer');
      if (reviewer !== 'human_executive') {
        throw new Error('Governed outreach human review requires human executive reviewer authority.');
      }
      const reason = input.reason === undefined ? undefined : requiredString(input.reason, 'reason');

      const reviewRequestRecord = await repository.getWorkflowEventById(reviewRequestRecordId);
      if (!reviewRequestRecord) throw new Error(`Governed outreach human review request ${reviewRequestRecordId} was not found.`);
      if (reviewRequestRecord.eventType !== 'sales_governed_outreach_human_review_requested') {
        throw new Error('Human review decision requires a governed outreach human review request.');
      }
      if (reviewRequestRecord.actorType !== 'agent' || reviewRequestRecord.actorId !== 'sales_agent') {
        throw new Error('Human review decision requires a Sales Agent review request record.');
      }

      const request = payloadObject(reviewRequestRecord, 'Governed outreach human review request');
      if (
        request.status !== 'pending_human_outreach_review'
        || request.humanReviewRequired !== true
        || request.preparationOnly !== true
        || request.nextAction !== 'await_human_outreach_review'
      ) {
        throw new Error('Governed outreach human review request is not pending review.');
      }
      if (
        request.outreachAuthorised !== true
        || request.dispatchAuthorised !== false
        || request.sendAuthorised !== false
        || request.pricingAuthorised !== false
        || request.commercialCommitmentAuthorised !== false
      ) {
        throw new Error('Governed outreach human review request has invalid authority state.');
      }

      const existing = await repository.findWorkflowEventByTypeAndPayloadField(
        'sales_governed_outreach_human_review_resolved',
        'reviewRequestRecordId',
        reviewRequestRecord.id,
      );
      if (existing) throw new Error(`Human outreach review ${reviewRequestRecord.id} has already been resolved.`);

      const decision: SalesGovernedOutreachHumanReviewDecisionResult = {
        reviewRequestRecordId: reviewRequestRecord.id,
        preparationRecordId: requiredString(request.preparationRecordId, 'preparationRecordId'),
        resolutionRecordId: requiredString(request.resolutionRecordId, 'resolutionRecordId'),
        decision: input.decision,
        reviewer: 'human_executive',
        reviewComplete: true,
        preparationOnly: true,
        outreachAuthorised: false,
        dispatchAuthorised: false,
        sendAuthorised: false,
        pricingAuthorised: false,
        commercialCommitmentAuthorised: false,
        nextAction: input.decision === 'approved'
          ? 'prepare_supervised_send_gate'
          : 'hold_governed_outreach_preparation',
        ...(reason !== undefined ? { reason } : {}),
      };

      const record = await repository.createWorkflowEvent({
        eventType: 'sales_governed_outreach_human_review_resolved',
        actorType: 'founder',
        actorId: 'human_executive',
        payload: decision,
      });

      return { decision, record };
    },
  };
}

export type SalesGovernedOutreachHumanReviewDecisionService = ReturnType<typeof createSalesGovernedOutreachHumanReviewDecisionService>;
