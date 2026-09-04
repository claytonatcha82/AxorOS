import type { OperationalRepository, WorkflowEventRecord } from '../data/operational-repository.js';

export interface SalesGovernedOutreachHumanReviewRequest {
  preparationRecordId: string;
  resolutionRecordId: string;
  leadId: string;
  salesIntakeExecutionId: string;
  company: string;
  recipientEmail: string;
  subject: string;
  body: string;
  atlasSourcePaths: string[];
  status: 'pending_human_outreach_review';
  humanReviewRequired: true;
  preparationOnly: true;
  outreachAuthorised: true;
  dispatchAuthorised: false;
  sendAuthorised: false;
  pricingAuthorised: false;
  commercialCommitmentAuthorised: false;
  nextAction: 'await_human_outreach_review';
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required.`);
  return value.trim();
}

function requiredStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${field} is required.`);
  const normalized = value.map((entry) => requiredString(entry, field));
  return [...new Set(normalized)];
}

function payloadObject(record: WorkflowEventRecord): Record<string, unknown> {
  if (!record.payload || typeof record.payload !== 'object' || Array.isArray(record.payload)) {
    throw new Error('Governed outreach preparation payload is invalid.');
  }
  return record.payload as Record<string, unknown>;
}

export function createSalesGovernedOutreachHumanReviewRequestService(
  repository: Pick<OperationalRepository, 'getWorkflowEventById' | 'findWorkflowEventByTypeAndPayloadField' | 'createWorkflowEvent'>,
) {
  return {
    async request(preparationRecordId: string): Promise<{
      reviewRequest: SalesGovernedOutreachHumanReviewRequest;
      record: WorkflowEventRecord;
    }> {
      const normalizedPreparationRecordId = requiredString(preparationRecordId, 'preparationRecordId');
      const preparationRecord = await repository.getWorkflowEventById(normalizedPreparationRecordId);
      if (!preparationRecord) throw new Error(`Governed outreach preparation ${normalizedPreparationRecordId} was not found.`);
      if (preparationRecord.eventType !== 'sales_governed_outreach_prepared') {
        throw new Error('Human outreach review requires a governed outreach preparation record.');
      }
      if (preparationRecord.actorType !== 'agent' || preparationRecord.actorId !== 'sales_agent') {
        throw new Error('Human outreach review requires a Sales Agent preparation record.');
      }

      const preparation = payloadObject(preparationRecord);
      if (
        preparation.status !== 'prepared_for_human_review'
        || preparation.preparationOnly !== true
        || preparation.humanReviewRequired !== true
        || preparation.nextAction !== 'request_human_outreach_review'
      ) {
        throw new Error('Governed outreach preparation is not awaiting human review.');
      }
      if (
        preparation.outreachAuthorised !== true
        || preparation.dispatchAuthorised !== false
        || preparation.sendAuthorised !== false
        || preparation.pricingAuthorised !== false
        || preparation.commercialCommitmentAuthorised !== false
      ) {
        throw new Error('Human outreach review cannot alter or inherit dispatch, send, pricing, or commercial commitment authority.');
      }

      const existing = await repository.findWorkflowEventByTypeAndPayloadField(
        'sales_governed_outreach_human_review_requested',
        'preparationRecordId',
        preparationRecord.id,
      );
      if (existing) throw new Error(`Human outreach review for preparation ${preparationRecord.id} already exists.`);

      const reviewRequest: SalesGovernedOutreachHumanReviewRequest = {
        preparationRecordId: preparationRecord.id,
        resolutionRecordId: requiredString(preparation.resolutionRecordId, 'resolutionRecordId'),
        leadId: requiredString(preparation.leadId, 'leadId'),
        salesIntakeExecutionId: requiredString(preparation.salesIntakeExecutionId, 'salesIntakeExecutionId'),
        company: requiredString(preparation.company, 'company'),
        recipientEmail: requiredString(preparation.recipientEmail, 'recipientEmail'),
        subject: requiredString(preparation.subject, 'subject'),
        body: requiredString(preparation.body, 'body'),
        atlasSourcePaths: requiredStringArray(preparation.atlasSourcePaths, 'atlasSourcePaths'),
        status: 'pending_human_outreach_review',
        humanReviewRequired: true,
        preparationOnly: true,
        outreachAuthorised: true,
        dispatchAuthorised: false,
        sendAuthorised: false,
        pricingAuthorised: false,
        commercialCommitmentAuthorised: false,
        nextAction: 'await_human_outreach_review',
      };

      const record = await repository.createWorkflowEvent({
        eventType: 'sales_governed_outreach_human_review_requested',
        actorType: 'agent',
        actorId: 'sales_agent',
        payload: reviewRequest,
      });

      return { reviewRequest, record };
    },
  };
}

export type SalesGovernedOutreachHumanReviewRequestService = ReturnType<typeof createSalesGovernedOutreachHumanReviewRequestService>;
