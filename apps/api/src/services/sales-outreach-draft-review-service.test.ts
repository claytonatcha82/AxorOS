import assert from 'node:assert/strict';
import test from 'node:test';
import type { WorkflowEventRecord } from '../data/operational-repository.js';
import { createSalesOutreachDraftReviewService } from './sales-outreach-draft-review-service.js';

const now = '2026-08-20T18:40:00.000Z';

function draftRecord(overrides: Record<string, unknown> = {}): WorkflowEventRecord {
  return {
    id: 'workflow-draft-1', clientId: null, projectId: null,
    eventType: 'sales_internal_outreach_draft_recorded', actorType: 'agent', actorId: 'sales_agent',
    payload: {
      leadId: 'lead-1', assessmentRecordId: 'assessment-1', salesIntakeExecutionId: 'sales-intake-1',
      subject: 'Website opportunity', body: 'Hello', recipientEmail: 'lead@example.com',
      atlasSourcePaths: ['Volume 1 - Agency/06 Sales System/Sales Agent.md'],
      status: 'internal_review_required', humanReviewRequired: true, preparationOnly: true,
      outreachAuthorised: false, sendAuthorised: false, pricingAuthorised: false,
      commercialCommitmentAuthorised: false, nextAction: 'request_human_outreach_draft_review',
      ...overrides,
    },
    createdAt: now,
  };
}

function harness(record = draftRecord()) {
  const events: WorkflowEventRecord[] = [];
  const service = createSalesOutreachDraftReviewService({
    async getWorkflowEventById(id) { return id === record.id ? record : null; },
    async createWorkflowEvent(input) {
      const created: WorkflowEventRecord = {
        id: `review-${events.length + 1}`, clientId: null, projectId: null,
        eventType: input.eventType, actorType: input.actorType, actorId: input.actorId ?? null,
        payload: input.payload ?? {}, createdAt: now,
      };
      events.push(created);
      return created;
    },
  });
  return { service, events };
}

test('human executive can approve persisted internal outreach draft without authorising send', async () => {
  const { service, events } = harness();
  const result = await service.review('workflow-draft-1', 'approved');

  assert.equal(result.review.decision, 'approved');
  assert.equal(result.review.reviewer, 'human_executive');
  assert.equal(result.review.reviewComplete, true);
  assert.equal(result.review.outreachAuthorised, false);
  assert.equal(result.review.sendAuthorised, false);
  assert.equal(result.review.pricingAuthorised, false);
  assert.equal(result.review.commercialCommitmentAuthorised, false);
  assert.equal(result.review.nextAction, 'prepare_supervised_send_gate');
  assert.equal(events.length, 1);
  assert.equal(events[0]?.eventType, 'sales_outreach_draft_review_recorded');
  assert.equal(events[0]?.actorType, 'founder');
  assert.equal(events[0]?.actorId, 'human_executive');
});

test('human executive can reject persisted internal outreach draft and route it to revision', async () => {
  const { service } = harness();
  const result = await service.review('workflow-draft-1', 'rejected');
  assert.equal(result.review.decision, 'rejected');
  assert.equal(result.review.nextAction, 'revise_internal_outreach_draft');
  assert.equal(result.review.sendAuthorised, false);
});

test('draft review refuses a draft carrying send authority', async () => {
  const { service, events } = harness(draftRecord({ sendAuthorised: true }));
  await assert.rejects(
    service.review('workflow-draft-1', 'approved'),
    /must not inherit outreach, send, pricing, or commercial commitment authority/i,
  );
  assert.equal(events.length, 0);
});

test('draft review refuses non-draft workflow records', async () => {
  const record = { ...draftRecord(), eventType: 'sales_opportunity_assessment_recorded' };
  const { service, events } = harness(record);
  await assert.rejects(
    service.review('workflow-draft-1', 'approved'),
    /requires a persisted internal Sales outreach draft record/i,
  );
  assert.equal(events.length, 0);
});
