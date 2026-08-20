import type { OperationalRepository } from '../data/operational-repository.js';

export type SalesSupervisedSendDecision = 'approved' | 'rejected';

export interface SalesSupervisedSendGate {
  draftReviewRecordId: string;
  draftRecordId: string;
  leadId: string;
  decision: SalesSupervisedSendDecision;
  approver: 'human_executive';
  supervised: true;
  outreachAuthorised: false;
  sendAuthorised: boolean;
  pricingAuthorised: false;
  commercialCommitmentAuthorised: false;
  nextAction: 'execute_supervised_email_send' | 'return_to_outreach_review';
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required.`);
  return value.trim();
}

export function createSalesSupervisedSendGateService(
  repository: Pick<OperationalRepository, 'getWorkflowEventById' | 'createWorkflowEvent'>,
) {
  return {
    async decide(draftReviewRecordId: string, decision: SalesSupervisedSendDecision) {
      const normalizedReviewRecordId = requiredString(draftReviewRecordId, 'draftReviewRecordId');
      if (decision !== 'approved' && decision !== 'rejected') {
        throw new Error('decision must be approved or rejected.');
      }

      const reviewRecord = await repository.getWorkflowEventById(normalizedReviewRecordId);
      if (!reviewRecord) throw new Error(`Sales outreach draft review record ${normalizedReviewRecordId} was not found.`);
      if (reviewRecord.eventType !== 'sales_outreach_draft_review_recorded') {
        throw new Error('Supervised send approval requires a persisted outreach draft review record.');
      }
      if (reviewRecord.actorType !== 'founder' || reviewRecord.actorId !== 'human_executive') {
        throw new Error('Supervised send approval requires human executive draft review provenance.');
      }
      if (!reviewRecord.payload || typeof reviewRecord.payload !== 'object' || Array.isArray(reviewRecord.payload)) {
        throw new Error('Sales outreach draft review payload is invalid.');
      }

      const payload = reviewRecord.payload as Record<string, unknown>;
      if (payload.decision !== 'approved' || payload.reviewComplete !== true) {
        throw new Error('Supervised send approval requires an approved, completed outreach draft review.');
      }
      if (payload.reviewer !== 'human_executive') {
        throw new Error('Supervised send approval requires human executive review.');
      }
      if (payload.nextAction !== 'prepare_supervised_send_gate') {
        throw new Error('Outreach draft review is not ready for supervised send approval.');
      }
      if (
        payload.outreachAuthorised !== false
        || payload.sendAuthorised !== false
        || payload.pricingAuthorised !== false
        || payload.commercialCommitmentAuthorised !== false
      ) {
        throw new Error('Supervised send approval must start from a review record with no inherited authority.');
      }

      const gate: SalesSupervisedSendGate = {
        draftReviewRecordId: reviewRecord.id,
        draftRecordId: requiredString(payload.draftRecordId, 'draftRecordId'),
        leadId: requiredString(payload.leadId, 'leadId'),
        decision,
        approver: 'human_executive',
        supervised: true,
        outreachAuthorised: false,
        sendAuthorised: decision === 'approved',
        pricingAuthorised: false,
        commercialCommitmentAuthorised: false,
        nextAction: decision === 'approved'
          ? 'execute_supervised_email_send'
          : 'return_to_outreach_review',
      };

      const record = await repository.createWorkflowEvent({
        eventType: 'sales_supervised_send_gate_recorded',
        actorType: 'founder',
        actorId: 'human_executive',
        payload: gate,
      });

      return { gate, record };
    },
  };
}

export type SalesSupervisedSendGateService = ReturnType<typeof createSalesSupervisedSendGateService>;
