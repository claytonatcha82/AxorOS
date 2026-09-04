import type { OperationalRepository, WorkflowEventRecord } from '../data/operational-repository.js';

export interface SalesGovernedOutreachPreparation {
  resolutionRecordId: string;
  approvalRequestId: string;
  approvalRecordId: string;
  leadId: string;
  salesIntakeExecutionId: string;
  company: string;
  recipientEmail: string;
  subject: string;
  body: string;
  atlasSourcePaths: string[];
  status: 'prepared_for_human_review';
  preparationOnly: true;
  outreachAuthorised: true;
  dispatchAuthorised: false;
  sendAuthorised: false;
  pricingAuthorised: false;
  commercialCommitmentAuthorised: false;
  humanReviewRequired: true;
  nextAction: 'request_human_outreach_review';
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

function payloadObject(record: WorkflowEventRecord, field: string): Record<string, unknown> {
  if (!record.payload || typeof record.payload !== 'object' || Array.isArray(record.payload)) {
    throw new Error(`${field} payload is invalid.`);
  }
  return record.payload as Record<string, unknown>;
}

export function createSalesGovernedOutreachPreparationService(
  repository: Pick<OperationalRepository, 'getWorkflowEventById' | 'getLeadById' | 'createWorkflowEvent' | 'findWorkflowEventByTypeAndPayloadField'>,
) {
  return {
    async prepare(input: {
      resolutionRecordId: string;
      subject: string;
      body: string;
    }): Promise<{ preparation: SalesGovernedOutreachPreparation; record: WorkflowEventRecord }> {
      const resolutionRecordId = requiredString(input.resolutionRecordId, 'resolutionRecordId');
      const subject = requiredString(input.subject, 'subject');
      const body = requiredString(input.body, 'body');

      const resolutionRecord = await repository.getWorkflowEventById(resolutionRecordId);
      if (!resolutionRecord) throw new Error(`Sales outreach approval resolution ${resolutionRecordId} was not found.`);
      if (resolutionRecord.eventType !== 'sales_outreach_approval_resolved') {
        throw new Error('Governed outreach preparation requires a persisted Sales outreach approval resolution.');
      }
      if (resolutionRecord.actorType !== 'founder' || resolutionRecord.actorId !== 'founder') {
        throw new Error('Governed outreach preparation requires a founder-resolved approval record.');
      }

      const resolution = payloadObject(resolutionRecord, 'Sales outreach approval resolution');
      if (resolution.decision !== 'approved' || resolution.status !== 'approved') {
        throw new Error('Governed outreach preparation requires an approved Sales outreach resolution.');
      }
      if (resolution.outreachAuthorised !== true) {
        throw new Error('Approved Sales outreach resolution must authorise outreach preparation.');
      }
      if (
        resolution.pricingAuthorised !== false
        || resolution.commercialCommitmentAuthorised !== false
      ) {
        throw new Error('Governed outreach preparation cannot inherit pricing or commercial commitment authority.');
      }

      const existing = await repository.findWorkflowEventByTypeAndPayloadField(
        'sales_governed_outreach_prepared',
        'resolutionRecordId',
        resolutionRecord.id,
      );
      if (existing) throw new Error(`Outreach preparation for resolution ${resolutionRecord.id} already exists.`);

      const leadId = requiredString(resolution.leadId, 'leadId');
      const lead = await repository.getLeadById(leadId);
      if (!lead) throw new Error(`Lead not found: ${leadId}.`);
      const recipientEmail = requiredString(lead.contactEmail ?? '', 'lead.contactEmail');
      const atlasSourcePaths = requiredStringArray(resolution.atlasSourcePaths, 'atlasSourcePaths');

      const preparation: SalesGovernedOutreachPreparation = {
        resolutionRecordId: resolutionRecord.id,
        approvalRequestId: requiredString(resolution.approvalRequestId, 'approvalRequestId'),
        approvalRecordId: requiredString(resolution.approvalRecordId, 'approvalRecordId'),
        leadId,
        salesIntakeExecutionId: requiredString(resolution.salesIntakeExecutionId, 'salesIntakeExecutionId'),
        company: requiredString(resolution.company, 'company'),
        recipientEmail,
        subject,
        body,
        atlasSourcePaths,
        status: 'prepared_for_human_review',
        preparationOnly: true,
        outreachAuthorised: true,
        dispatchAuthorised: false,
        sendAuthorised: false,
        pricingAuthorised: false,
        commercialCommitmentAuthorised: false,
        humanReviewRequired: true,
        nextAction: 'request_human_outreach_review',
      };

      const record = await repository.createWorkflowEvent({
        eventType: 'sales_governed_outreach_prepared',
        actorType: 'agent',
        actorId: 'sales_agent',
        payload: preparation,
      });

      return { preparation, record };
    },
  };
}

export type SalesGovernedOutreachPreparationService = ReturnType<typeof createSalesGovernedOutreachPreparationService>;
