import { describe, expect, it } from 'vitest';
import type { LeadRecord, WorkflowEventRecord } from '../data/operational-repository.js';
import { createSalesGovernedOutreachHumanReviewRequestService } from './sales-governed-outreach-human-review-request-service.js';

const lead: LeadRecord = {
  id: 'lead-1', clientId: null, companyName: 'Example Construction', contactName: 'Jane Doe', contactEmail: 'jane@example.com', source: 'pilot', opportunitySummary: 'Website opportunity', leadScore: 40, status: 'qualified', enrichmentStatus: 'verified', evidence: [], createdAt: '2026-09-04T00:00:00.000Z', updatedAt: '2026-09-04T00:00:00.000Z',
};

const preparationPayload = {
  resolutionRecordId: 'resolution-1', approvalRequestId: 'request-1', approvalRecordId: 'approval-1', leadId: 'lead-1', salesIntakeExecutionId: 'intake-1', company: lead.companyName, recipientEmail: lead.contactEmail, subject: 'A better website for Example Construction', body: 'Hello Jane,', atlasSourcePaths: ['Volume 1 - Agency/01 - Ideal Client Profile.md'], status: 'prepared_for_human_review', preparationOnly: true, outreachAuthorised: true, dispatchAuthorised: false, sendAuthorised: false, pricingAuthorised: false, commercialCommitmentAuthorised: false, humanReviewRequired: true, nextAction: 'request_human_outreach_review',
};

function event(payload: unknown = preparationPayload, overrides: Partial<WorkflowEventRecord> = {}): WorkflowEventRecord {
  return { id: 'preparation-1', clientId: null, projectId: null, eventType: 'sales_governed_outreach_prepared', actorType: 'agent', actorId: 'sales_agent', payload, createdAt: '2026-09-04T00:00:00.000Z', ...overrides };
}

describe('Sales governed outreach human review request service', () => {
  it('creates a pending human review request without granting dispatch or send authority', async () => {
    const created: unknown[] = [];
    const service = createSalesGovernedOutreachHumanReviewRequestService({
      getWorkflowEventById: async () => event(),
      findWorkflowEventByTypeAndPayloadField: async () => null,
      createWorkflowEvent: async (input) => {
        created.push(input);
        return event(input.payload, { id: 'review-1', eventType: input.eventType, actorType: input.actorType, actorId: input.actorId ?? null });
      },
    });

    const result = await service.request('preparation-1');

    expect(result.reviewRequest.status).toBe('pending_human_outreach_review');
    expect(result.reviewRequest.humanReviewRequired).toBe(true);
    expect(result.reviewRequest.outreachAuthorised).toBe(true);
    expect(result.reviewRequest.dispatchAuthorised).toBe(false);
    expect(result.reviewRequest.sendAuthorised).toBe(false);
    expect(created).toHaveLength(1);
  });

  it('blocks forged preparation authority', async () => {
    const service = createSalesGovernedOutreachHumanReviewRequestService({
      getWorkflowEventById: async () => event({ ...preparationPayload, dispatchAuthorised: true }),
      findWorkflowEventByTypeAndPayloadField: async () => null,
      createWorkflowEvent: async () => event(),
    });

    await expect(service.request('preparation-1')).rejects.toThrow(/cannot alter or inherit dispatch/);
  });

  it('blocks non-Sales Agent preparation records', async () => {
    const service = createSalesGovernedOutreachHumanReviewRequestService({
      getWorkflowEventById: async () => event(preparationPayload, { actorId: 'other_agent' }),
      findWorkflowEventByTypeAndPayloadField: async () => null,
      createWorkflowEvent: async () => event(),
    });

    await expect(service.request('preparation-1')).rejects.toThrow(/Sales Agent preparation record/);
  });

  it('blocks duplicate review requests', async () => {
    const service = createSalesGovernedOutreachHumanReviewRequestService({
      getWorkflowEventById: async () => event(),
      findWorkflowEventByTypeAndPayloadField: async () => event({}, { id: 'existing-review' }),
      createWorkflowEvent: async () => event(),
    });

    await expect(service.request('preparation-1')).rejects.toThrow(/already exists/);
  });
});
