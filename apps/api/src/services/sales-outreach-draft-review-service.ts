import type { OperationalRepository } from '../data/operational-repository.js';

export type SalesOutreachDraftReviewDecision = 'approved' | 'rejected';

export interface SalesOutreachDraftReview {
  draftRecordId: string;
  leadId: string;
  decision: SalesOutreachDraftReviewDecision;
  reviewer: 'human_executive';
  reviewComplete: true;
  outreachAuthorised: false;
  sendAuthorised: false;
  pricingAuthorised: false;
  commercialCommitmentAuthorised: false;
  nextAction: 'prepare_supervised_send_gate' | 'revise_internal_outreach_draft';
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required.`);
  return value.trim();
}

export function createSalesOutreachDraftReviewService(
  repository: Pick<OperationalRepository, 'getWorkflowEventById' | 'createWorkflowEvent'>,
) {
  return {
    async review(draftRecordId: string, decision: SalesOutreachDraftReviewDecision) {
      const normalizedDraftRecordId = requiredString(draftRecordId, 'draftRecordId');
      if (decision !== 'approved' && decision !== 'rejected') {
        throw new Error('decision must be approved or rejected.');
      }

      const draftRecord = await repository.getWorkflowEventById(normalizedDraftRecordId);
      if (!draftRecord) throw new Error(`Sales outreach draft record ${normalizedDraftRecordId} was not found.`);
      if (draftRecord.eventType !== 'sales_internal_outreach_draft_recorded') {
        throw new Error('Outreach draft review requires a persisted internal Sales outreach draft record.');
      }
      if (draftRecord.actorType !== 'agent' || draftRecord.actorId !== 'sales_agent') {
        throw new Error('Outreach draft review requires a Sales Agent draft record.');
      }
      if (!draftRecord.payload || typeof draftRecord.payload !== 'object' || Array.isArray(draftRecord.payload)) {
        throw new Error('Sales outreach draft payload is invalid.');
      }

      const payload = draftRecord.payload as Record<string, unknown>;
      if (payload.status !== 'internal_review_required' || payload.humanReviewRequired !== true) {
        throw new Error('Sales outreach draft is not awaiting human review.');
      }
      if (payload.nextAction !== 'request_human_outreach_draft_review') {
        throw new Error('Sales outreach draft is not ready for human review.');
      }
      if (
        payload.outreachAuthorised !== false
        || payload.sendAuthorised !== false
        || payload.pricingAuthorised !== false
        || payload.commercialCommitmentAuthorised !== false
      ) {
        throw new Error('Human draft review must not inherit outreach, send, pricing, or commercial commitment authority.');
      }

      const review: SalesOutreachDraftReview = {
        draftRecordId: draftRecord.id,
        leadId: requiredString(payload.leadId, 'leadId'),
        decision,
        reviewer: 'human_executive',
        reviewComplete: true,
        outreachAuthorised: false,
        sendAuthorised: false,
        pricingAuthorised: false,
        commercialCommitmentAuthorised: false,
        nextAction: decision === 'approved'
          ? 'prepare_supervised_send_gate'
          : 'revise_internal_outreach_draft',
      };

      const record = await repository.createWorkflowEvent({
        eventType: 'sales_outreach_draft_review_recorded',
        actorType: 'founder',
        actorId: 'human_executive',
        payload: review,
      });

      return { review, record };
    },
  };
}

export type SalesOutreachDraftReviewService = ReturnType<typeof createSalesOutreachDraftReviewService>;
