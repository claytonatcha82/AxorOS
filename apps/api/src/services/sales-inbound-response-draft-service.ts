import type { OperationalRepository } from '../data/operational-repository.js';
import type { SalesInboundNextActionResolution } from './sales-inbound-next-action-resolver.js';

export interface SalesInboundResponseDraftInput {
  resolution: SalesInboundNextActionResolution;
  leadId: string;
  recipientEmail: string;
  subject: string;
  body: string;
}

export interface SalesInboundResponseDraft {
  inboundEvidenceId: string;
  providerMessageId: string;
  leadId: string;
  recipientEmail: string;
  subject: string;
  body: string;
  primaryCategory: SalesInboundNextActionResolution['primaryCategory'];
  governedNextAction: SalesInboundNextActionResolution['nextAction'];
  owner: SalesInboundNextActionResolution['owner'];
  status: 'internal_review_required';
  humanReviewRequired: true;
  preparationOnly: true;
  responseAuthorised: false;
  sendAuthorised: false;
  pricingAuthorised: false;
  discountAuthorised: false;
  commercialCommitmentAuthorised: false;
  contractAuthorised: false;
  nextAction: 'request_human_inbound_response_draft_review';
}

function required(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${field} is required.`);
  return trimmed;
}

export function createSalesInboundResponseDraftService(
  repository: Pick<OperationalRepository, 'createWorkflowEvent'>,
) {
  return {
    async create(input: SalesInboundResponseDraftInput) {
      const resolution = input.resolution;

      if (resolution.humanReviewRequired !== true) {
        throw new Error('Stage 1 inbound response drafting requires human review.');
      }
      if (
        resolution.autonomousResponseAuthorised !== false ||
        resolution.sendAuthorised !== false ||
        resolution.pricingAuthorised !== false ||
        resolution.discountAuthorised !== false ||
        resolution.commercialCommitmentAuthorised !== false ||
        resolution.contractAuthorised !== false
      ) {
        throw new Error('Inbound response drafting must not inherit consequential authority.');
      }
      if (
        resolution.primaryCategory === 'opt_out' ||
        resolution.primaryCategory === 'automated_response' ||
        resolution.primaryCategory === 'delivery_failure' ||
        resolution.primaryCategory === 'not_interested'
      ) {
        throw new Error(`Inbound category ${resolution.primaryCategory} is not eligible for response drafting.`);
      }

      const draft: SalesInboundResponseDraft = {
        inboundEvidenceId: required(resolution.inboundEvidenceId, 'inboundEvidenceId'),
        providerMessageId: required(resolution.providerMessageId, 'providerMessageId'),
        leadId: required(input.leadId, 'leadId'),
        recipientEmail: required(input.recipientEmail, 'recipientEmail'),
        subject: required(input.subject, 'subject'),
        body: required(input.body, 'body'),
        primaryCategory: resolution.primaryCategory,
        governedNextAction: resolution.nextAction,
        owner: resolution.owner,
        status: 'internal_review_required',
        humanReviewRequired: true,
        preparationOnly: true,
        responseAuthorised: false,
        sendAuthorised: false,
        pricingAuthorised: false,
        discountAuthorised: false,
        commercialCommitmentAuthorised: false,
        contractAuthorised: false,
        nextAction: 'request_human_inbound_response_draft_review',
      };

      const record = await repository.createWorkflowEvent({
        eventType: 'sales_inbound_response_draft_recorded',
        actorType: 'agent',
        actorId: 'sales_agent',
        payload: draft,
      });

      return { draft, record };
    },
  };
}

export type SalesInboundResponseDraftService = ReturnType<typeof createSalesInboundResponseDraftService>;
