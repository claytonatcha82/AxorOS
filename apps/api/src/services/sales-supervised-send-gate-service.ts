import type { OperationalRepository } from '../data/operational-repository.js';
import type { SalesOutreachSuppressionPostgresStore } from '../data/sales-outreach-suppression-postgres-store.js';

export type SalesSupervisedSendDecision = 'approved' | 'rejected';
export type SalesSupervisedSendDraftKind = 'outreach' | 'inbound_response';

export interface SalesSupervisedSendGate {
  draftReviewRecordId: string;
  draftRecordId: string;
  leadId: string;
  draftKind: SalesSupervisedSendDraftKind;
  decision: SalesSupervisedSendDecision;
  approver: 'human_executive';
  supervised: true;
  responseAuthorised: false;
  outreachAuthorised: false;
  sendAuthorised: boolean;
  pricingAuthorised: false;
  discountAuthorised: false;
  commercialCommitmentAuthorised: false;
  contractAuthorised: false;
  nextAction: 'execute_supervised_email_send' | 'return_to_outreach_review' | 'return_to_inbound_response_review';
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required.`);
  return value.trim();
}

function draftKindForReviewEventType(eventType: string): SalesSupervisedSendDraftKind {
  if (eventType === 'sales_outreach_draft_review_recorded') return 'outreach';
  if (eventType === 'sales_inbound_response_draft_review_recorded') return 'inbound_response';
  throw new Error('Supervised send approval requires a persisted outreach or inbound response draft review record.');
}

export function createSalesSupervisedSendGateService(
  repository: Pick<OperationalRepository, 'getWorkflowEventById' | 'createWorkflowEvent'>,
  suppressions?: Pick<SalesOutreachSuppressionPostgresStore, 'isActiveForRecipient'>,
) {
  return {
    async decide(draftReviewRecordId: string, decision: SalesSupervisedSendDecision) {
      const normalizedReviewRecordId = requiredString(draftReviewRecordId, 'draftReviewRecordId');
      if (decision !== 'approved' && decision !== 'rejected') {
        throw new Error('decision must be approved or rejected.');
      }

      const reviewRecord = await repository.getWorkflowEventById(normalizedReviewRecordId);
      if (!reviewRecord) throw new Error(`Sales draft review record ${normalizedReviewRecordId} was not found.`);
      const draftKind = draftKindForReviewEventType(reviewRecord.eventType);
      if (reviewRecord.actorType !== 'founder' || reviewRecord.actorId !== 'human_executive') {
        throw new Error('Supervised send approval requires human executive draft review provenance.');
      }
      if (!reviewRecord.payload || typeof reviewRecord.payload !== 'object' || Array.isArray(reviewRecord.payload)) {
        throw new Error('Sales draft review payload is invalid.');
      }

      const payload = reviewRecord.payload as Record<string, unknown>;
      if (payload.decision !== 'approved' || payload.reviewComplete !== true) {
        throw new Error('Supervised send approval requires an approved, completed draft review.');
      }
      if (payload.reviewer !== 'human_executive') {
        throw new Error('Supervised send approval requires human executive review.');
      }
      if (payload.nextAction !== 'prepare_supervised_send_gate') {
        throw new Error('Sales draft review is not ready for supervised send approval.');
      }
      if (
        payload.outreachAuthorised !== false
        || payload.sendAuthorised !== false
        || payload.pricingAuthorised !== false
        || payload.commercialCommitmentAuthorised !== false
        || (draftKind === 'inbound_response' && (
          payload.responseAuthorised !== false
          || payload.discountAuthorised !== false
          || payload.contractAuthorised !== false
        ))
      ) {
        throw new Error('Supervised send approval must start from a review record with no inherited response, outreach, send, pricing, discount, commercial commitment, or contract authority.');
      }

      const draftRecordId = requiredString(payload.draftRecordId, 'draftRecordId');
      const leadId = requiredString(payload.leadId, 'leadId');
      if (decision === 'approved' && suppressions) {
        const draftRecord = await repository.getWorkflowEventById(draftRecordId);
        if (!draftRecord) throw new Error(`Sales draft record ${draftRecordId} was not found for suppression verification.`);
        if (!draftRecord.payload || typeof draftRecord.payload !== 'object' || Array.isArray(draftRecord.payload)) {
          throw new Error('Sales draft payload is invalid for suppression verification.');
        }
        const draftPayload = draftRecord.payload as Record<string, unknown>;
        const recipientEmail = requiredString(draftPayload.recipientEmail, 'draft.recipientEmail');
        if (await suppressions.isActiveForRecipient(recipientEmail)) {
          throw new Error(`Sales send approval blocked by active outreach suppression for ${recipientEmail}.`);
        }
      }

      const gate: SalesSupervisedSendGate = {
        draftReviewRecordId: reviewRecord.id,
        draftRecordId,
        leadId,
        draftKind,
        decision,
        approver: 'human_executive',
        supervised: true,
        responseAuthorised: false,
        outreachAuthorised: false,
        sendAuthorised: decision === 'approved',
        pricingAuthorised: false,
        discountAuthorised: false,
        commercialCommitmentAuthorised: false,
        contractAuthorised: false,
        nextAction: decision === 'approved'
          ? 'execute_supervised_email_send'
          : draftKind === 'outreach'
            ? 'return_to_outreach_review'
            : 'return_to_inbound_response_review',
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
