import assert from 'node:assert/strict';
import test from 'node:test';
import type { CreateWorkflowEventInput, LeadRecord, WorkflowEventRecord } from '../data/operational-repository.js';
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

test('creates a pending human review request without granting dispatch or send authority', async () => {
  const created: CreateWorkflowEventInput[] = [];
  const service = createSalesGovernedOutreachHumanReviewRequestService({
    getWorkflowEventById: async () => event(),
    findWorkflowEventByTypeAndPayloadField: async () => null,
    createWorkflowEvent: async (input) => {
      created.push(input);
      return event(input.payload, { id: 'review-1', eventType: input.eventType, actorType: input.actorType, actorId: input.actorId ?? null });
    },
  });

  const result = await service.request('preparation-1');

  assert.equal(result.reviewRequest.status, 'pending_human_outreach_review');
  assert.equal(result.reviewRequest.humanReviewRequired, true);
  assert.equal(result.reviewRequest.outreachAuthorised, true);
  assert.equal(result.reviewRequest.dispatchAuthorised, false);
  assert.equal(result.reviewRequest.sendAuthorised, false);
  assert.equal(created.length, 1);
  assert.equal(created[0]?.eventType, 'sales_governed_outreach_human_review_requested');
});

test('blocks forged preparation authority', async () => {
  const service = createSalesGovernedOutreachHumanReviewRequestService({
    getWorkflowEventById: async () => event({ ...preparationPayload, dispatchAuthorised: true }),
    findWorkflowEventByTypeAndPayloadField: async () => null,
    createWorkflowEvent: async () => event(),
  });

  await assert.rejects(() => service.request('preparation-1'), /cannot alter or inherit dispatch/);
});

test('blocks non-Sales Agent preparation records', async () => {
  const service = createSalesGovernedOutreachHumanReviewRequestService({
    getWorkflowEventById: async () => event(preparationPayload, { actorId: 'other_agent' }),
    findWorkflowEventByTypeAndPayloadField: async () => null,
    createWorkflowEvent: async () => event(),
  });

  await assert.rejects(() => service.request('preparation-1'), /Sales Agent preparation record/);
});

test('blocks duplicate review requests', async () => {
  const service = createSalesGovernedOutreachHumanReviewRequestService({
    getWorkflowEventById: async () => event(),
    findWorkflowEventByTypeAndPayloadField: async () => event({}, { id: 'existing-review' }),
    createWorkflowEvent: async () => event(),
  });

  await assert.rejects(() => service.request('preparation-1'), /already exists/);
});
