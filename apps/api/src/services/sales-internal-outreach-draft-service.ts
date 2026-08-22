import type { OperationalRepository } from '../data/operational-repository.js';
import type { SalesOutreachPreparationEligibility } from './sales-outreach-preparation-eligibility-service.js';

export interface SalesInternalOutreachDraftInput {
  eligibility: SalesOutreachPreparationEligibility;
  subject: string;
  body: string;
}

export interface SalesInternalOutreachDraft {
  leadId: string;
  assessmentRecordId: string;
  salesIntakeExecutionId: string;
  subject: string;
  body: string;
  recipientEmail: string;
  atlasSourcePaths: string[];
  status: 'internal_review_required';
  humanReviewRequired: true;
  preparationOnly: true;
  outreachAuthorised: false;
  sendAuthorised: false;
  pricingAuthorised: false;
  commercialCommitmentAuthorised: false;
  nextAction: 'request_human_outreach_draft_review';
}

function required(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${field} is required.`);
  return trimmed;
}

export function createSalesInternalOutreachDraftService(
  repository: Pick<OperationalRepository, 'getLeadById' | 'createWorkflowEvent'>,
) {
  return {
    async create(input: SalesInternalOutreachDraftInput) {
      const eligibility = input.eligibility;
      if (eligibility.eligible !== true || eligibility.preparationOnly !== true) {
        throw new Error('Internal outreach drafting requires preparation eligibility.');
      }
      if (
        eligibility.outreachAuthorised !== false
        || eligibility.sendAuthorised !== false
        || eligibility.pricingAuthorised !== false
        || eligibility.commercialCommitmentAuthorised !== false
      ) {
        throw new Error('Internal outreach drafting must not inherit outreach, send, pricing, or commercial commitment authority.');
      }
      if (eligibility.nextAction !== 'prepare_internal_outreach_draft') {
        throw new Error('Outreach preparation eligibility is not ready for internal drafting.');
      }
      if (eligibility.atlasSourcePaths.length === 0) {
        throw new Error('Internal outreach drafting requires Atlas provenance.');
      }

      const leadId = required(eligibility.leadId, 'leadId');
      const assessmentRecordId = required(eligibility.assessmentRecordId, 'assessmentRecordId');
      const salesIntakeExecutionId = required(eligibility.salesIntakeExecutionId, 'salesIntakeExecutionId');
      const subject = required(input.subject, 'subject');
      const body = required(input.body, 'body');

      const lead = await repository.getLeadById(leadId);
      if (!lead) throw new Error(`Lead not found: ${leadId}.`);
      const recipientEmail = required(lead.contactEmail ?? '', 'lead.contactEmail');

      const draft: SalesInternalOutreachDraft = {
        leadId,
        assessmentRecordId,
        salesIntakeExecutionId,
        subject,
        body,
        recipientEmail,
        atlasSourcePaths: [...new Set(eligibility.atlasSourcePaths)],
        status: 'internal_review_required',
        humanReviewRequired: true,
        preparationOnly: true,
        outreachAuthorised: false,
        sendAuthorised: false,
        pricingAuthorised: false,
        commercialCommitmentAuthorised: false,
        nextAction: 'request_human_outreach_draft_review',
      };

      const record = await repository.createWorkflowEvent({
        eventType: 'sales_internal_outreach_draft_recorded',
        actorType: 'agent',
        actorId: 'sales_agent',
        payload: draft,
      });

      return { draft, record };
    },
  };
}

export type SalesInternalOutreachDraftService = ReturnType<typeof createSalesInternalOutreachDraftService>;
