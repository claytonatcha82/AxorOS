import type { OperationalRepository } from '../data/operational-repository.js';

export type SalesOutreachDraftReviewDecision = 'approved' | 'rejected';
export type SalesDraftReviewKind = 'outreach' | 'inbound_response';

export interface SalesOutreachDraftReview {
  draftRecordId: string;
  leadId: string;
  draftKind: SalesDraftReviewKind;
  decision: SalesOutreachDraftReviewDecision;
  reviewer: 'human_executive';
  reviewComplete: true;
  responseAuthorised: false;
  outreachAuthorised: false;
  sendAuthorised: false;
  pricingAuthorised: false;
  discountAuthorised: false;
  commercialCommitmentAuthorised: false;
  contractAuthorised: false;
  nextAction: 'prepare_supervised_send_gate' | 'revise_internal_outreach_draft' | 'revise_inbound_response_draft';
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required.`);
  return value.trim();
}

function draftKindForEventType(eventType: string): SalesDraftReviewKind {
  if (eventType === 'sales_internal_outreach_draft_recorded') return 'outreach';
  if (eventType === 'sales_inbound_response_draft_recorded') return 'inbound_response';
  throw new Error('Sales draft review requires a persisted internal outreach or inbound response draft record.');
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
      if (!draftRecord) throw new Error(`Sales draft record ${normalizedDraftRecordId} was not found.`);
      const draftKind = draftKindForEventType(draftRecord.eventType);
      if (draftRecord.actorType !== 'agent' || draftRecord.actorId !== 'sales_agent') {
        throw new Error('Sales draft review requires a Sales Agent draft record.');
      }
      if (!draftRecord.payload || typeof draftRecord.payload !== 'object' || Array.isArray(draftRecord.payload)) {
        throw new Error('Sales draft payload is invalid.');
      }

      const payload = draftRecord.payload as Record<string, unknown>;
      if (payload.status !== 'internal_review_required' || payload.humanReviewRequired !== true) {
        throw new Error('Sales draft is not awaiting human review.');
      }
      const expectedNextAction = draftKind === 'outreach'
        ? 'request_human_outreach_draft_review'
        : 'request_human_inbound_response_draft_review';
      if (payload.nextAction !== expectedNextAction) {
        throw new Error('Sales draft is not ready for human review.');
      }
      if (
        payload.sendAuthorised !== false
        || payload.pricingAuthorised !== false
        || payload.commercialCommitmentAuthorised !== false
        || (draftKind === 'outreach' && payload.outreachAuthorised !== false)
        || (draftKind === 'inbound_response' && (
          payload.responseAuthorised !== false
          || payload.discountAuthorised !== false
          || payload.contractAuthorised !== false
        ))
      ) {
        throw new Error('Human draft review must not inherit response, outreach, send, pricing, discount, commercial commitment, or contract authority.');
      }

      const review: SalesOutreachDraftReview = {
        draftRecordId: draftRecord.id,
        leadId: requiredString(payload.leadId, 'leadId'),
        draftKind,
        decision,
        reviewer: 'human_executive',
        reviewComplete: true,
        responseAuthorised: false,
        outreachAuthorised: false,
        sendAuthorised: false,
        pricingAuthorised: false,
        discountAuthorised: false,
        commercialCommitmentAuthorised: false,
        contractAuthorised: false,
        nextAction: decision === 'approved'
          ? 'prepare_supervised_send_gate'
          : draftKind === 'outreach'
            ? 'revise_internal_outreach_draft'
            : 'revise_inbound_response_draft',
      };

      const record = await repository.createWorkflowEvent({
        eventType: draftKind === 'outreach'
          ? 'sales_outreach_draft_review_recorded'
          : 'sales_inbound_response_draft_review_recorded',
        actorType: 'founder',
        actorId: 'human_executive',
        payload: review,
      });

      return { review, record };
    },
  };
}

export type SalesOutreachDraftReviewService = ReturnType<typeof createSalesOutreachDraftReviewService>;
