import assert from 'node:assert/strict';
import test from 'node:test';
import type { WorkflowEventRecord } from '../data/operational-repository.js';
import { createSalesGovernedOutreachPreparationService } from './sales-governed-outreach-preparation-service.js';

function resolutionRecord(payloadOverrides: Record<string, unknown> = {}, overrides: Partial<WorkflowEventRecord> = {}): WorkflowEventRecord {
  return {
    id: 'resolution-1',
    clientId: null,
    projectId: null,
    eventType: 'sales_outreach_approval_resolved',
    actorType: 'founder',
    actorId: 'founder',
    payload: {
      approvalRequestId: 'approval-request-1',
      approvalRecordId: 'approval-record-1',
      leadId: 'lead-1',
      salesIntakeExecutionId: 'sales-intake-1',
      company: 'Example Construction',
      decision: 'approved',
      status: 'approved',
      atlasSourcePaths: ['Volume 1 - Agency/06 Sales System/Sales Agent.md'],
      outreachAuthorised: true,
      pricingAuthorised: false,
      commercialCommitmentAuthorised: false,
      ...payloadOverrides,
    },
    createdAt: '2026-09-04T18:00:00.000Z',
    ...overrides,
  };
}

function serviceFor(resolution: WorkflowEventRecord | null, lead: { contactEmail?: string } | null = { contactEmail: 'decisionmaker@example.com' }) {
  const events: Array<Record<string, unknown>> = [];
  return createSalesGovernedOutreachPreparationService({
    async getWorkflowEventById(id: string) {
      assert.equal(id, 'resolution-1');
      return resolution;
    },
    async getLeadById(id: string) {
      assert.equal(id, 'lead-1');
      return lead as never;
    },
    async findWorkflowEventByTypeAndPayloadField() {
      return null;
    },
    async createWorkflowEvent(input: Record<string, unknown>) {
      events.push(input);
      return { ...resolutionRecord(), id: 'preparation-1', ...input } as unknown as WorkflowEventRecord;
    },
  });
}

test('approved founder resolution produces preparation-only outreach package with send disabled', async () => {
  const result = await serviceFor(resolutionRecord()).prepare({
    resolutionRecordId: 'resolution-1',
    subject: 'A potential website improvement for Example Construction',
    body: 'We identified an opportunity to improve your online presence.',
  });

  assert.equal(result.preparation.resolutionRecordId, 'resolution-1');
  assert.equal(result.preparation.approvalRequestId, 'approval-request-1');
  assert.equal(result.preparation.recipientEmail, 'decisionmaker@example.com');
  assert.equal(result.preparation.outreachAuthorised, true);
  assert.equal(result.preparation.preparationOnly, true);
  assert.equal(result.preparation.dispatchAuthorised, false);
  assert.equal(result.preparation.sendAuthorised, false);
  assert.equal(result.preparation.pricingAuthorised, false);
  assert.equal(result.preparation.commercialCommitmentAuthorised, false);
  assert.equal(result.preparation.humanReviewRequired, true);
  assert.equal(result.preparation.nextAction, 'request_human_outreach_review');
  assert.equal(result.record.eventType, 'sales_governed_outreach_prepared');
});

test('denied founder resolution cannot produce outreach preparation', async () => {
  await assert.rejects(
    () => serviceFor(resolutionRecord({ decision: 'denied', status: 'denied', outreachAuthorised: false })).prepare({
      resolutionRecordId: 'resolution-1', subject: 'Subject', body: 'Body',
    }),
    /approved Sales outreach resolution/i,
  );
});

test('forged outreach authority without approved resolution fails closed', async () => {
  await assert.rejects(
    () => serviceFor(resolutionRecord({ decision: 'approved', status: 'approved', outreachAuthorised: false })).prepare({
      resolutionRecordId: 'resolution-1', subject: 'Subject', body: 'Body',
    }),
    /must authorise outreach preparation/i,
  );
});

test('missing recipient email prevents preparation', async () => {
  await assert.rejects(
    () => serviceFor(resolutionRecord(), {}).prepare({
      resolutionRecordId: 'resolution-1', subject: 'Subject', body: 'Body',
    }),
    /lead.contactEmail is required/i,
  );
});

test('existing preparation cannot be duplicated', async () => {
  const service = createSalesGovernedOutreachPreparationService({
    async getWorkflowEventById() { return resolutionRecord(); },
    async getLeadById() { return { contactEmail: 'decisionmaker@example.com' } as never; },
    async findWorkflowEventByTypeAndPayloadField() { return resolutionRecord({}, { id: 'existing-preparation' }); },
    async createWorkflowEvent() { throw new Error('should not create'); },
  });

  await assert.rejects(
    () => service.prepare({ resolutionRecordId: 'resolution-1', subject: 'Subject', body: 'Body' }),
    /already exists/i,
  );
});
