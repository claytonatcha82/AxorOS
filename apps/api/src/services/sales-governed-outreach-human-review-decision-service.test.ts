import test from 'node:test';
import assert from 'node:assert/strict';
import { createSalesGovernedOutreachHumanReviewDecisionService } from './sales-governed-outreach-human-review-decision-service.js';
import type { WorkflowEventRecord } from '../data/operational-repository.js';

type Repo = Parameters<typeof createSalesGovernedOutreachHumanReviewDecisionService>[0];

const requestRecord = (overrides: Record<string, unknown> = {}): WorkflowEventRecord => ({
  id: 'review-request-1',
  clientId: null,
  projectId: null,
  eventType: 'sales_governed_outreach_human_review_requested',
  actorType: 'agent',
  actorId: 'sales_agent',
  payload: {
    preparationRecordId: 'preparation-1',
    resolutionRecordId: 'resolution-1',
    leadId: 'lead-1',
    salesIntakeExecutionId: 'sales-intake-1',
    company: 'Example Construction',
    recipientEmail: 'owner@example.com',
    subject: 'Website opportunity',
    body: 'A prepared outreach message.',
    atlasSourcePaths: ['Volume 1 - Agency/ICP.md'],
    status: 'pending_human_outreach_review',
    humanReviewRequired: true,
    preparationOnly: true,
    outreachAuthorised: true,
    dispatchAuthorised: false,
    sendAuthorised: false,
    pricingAuthorised: false,
    commercialCommitmentAuthorised: false,
    nextAction: 'await_human_outreach_review',
    ...overrides,
  },
  createdAt: '2026-09-04T18:00:00.000Z',
});

function repository(record: WorkflowEventRecord = requestRecord(), existing: WorkflowEventRecord | null = null): Repo {
  return {
    getWorkflowEventById: async () => record,
    findWorkflowEventByTypeAndPayloadField: async () => existing,
    createWorkflowEvent: async (input) => ({
      id: 'resolution-1',
      clientId: null,
      projectId: null,
      createdAt: '2026-09-04T18:00:01.000Z',
      ...input,
      actorId: input.actorId ?? null,
      payload: input.payload ?? {},
    }),
  } as Repo;
}

test('approves a valid governed outreach review without granting send authority', async () => {
  const service = createSalesGovernedOutreachHumanReviewDecisionService(repository());
  const result = await service.decide({
    reviewRequestRecordId: 'review-request-1',
    decision: 'approved',
    reviewer: 'human_executive',
  });

  assert.equal(result.decision.decision, 'approved');
  assert.equal(result.decision.reviewComplete, true);
  assert.equal(result.decision.nextAction, 'prepare_supervised_send_gate');
  assert.equal(result.decision.outreachAuthorised, false);
  assert.equal(result.decision.dispatchAuthorised, false);
  assert.equal(result.decision.sendAuthorised, false);
  assert.equal(result.decision.pricingAuthorised, false);
  assert.equal(result.decision.commercialCommitmentAuthorised, false);
});

test('denies a valid governed outreach review and holds preparation', async () => {
  const service = createSalesGovernedOutreachHumanReviewDecisionService(repository());
  const result = await service.decide({
    reviewRequestRecordId: 'review-request-1',
    decision: 'denied',
    reviewer: 'human_executive',
    reason: 'Do not contact this prospect.',
  });

  assert.equal(result.decision.decision, 'denied');
  assert.equal(result.decision.nextAction, 'hold_governed_outreach_preparation');
  assert.equal(result.decision.reason, 'Do not contact this prospect.');
  assert.equal(result.decision.sendAuthorised, false);
  assert.equal(result.decision.dispatchAuthorised, false);
});

test('blocks forged reviewer identity', async () => {
  const service = createSalesGovernedOutreachHumanReviewDecisionService(repository());
  await assert.rejects(
    service.decide({ reviewRequestRecordId: 'review-request-1', decision: 'approved', reviewer: 'sales_agent' }),
    /human executive reviewer authority/,
  );
});

test('blocks malformed or unauthorized review requests', async () => {
  const unauthorized = createSalesGovernedOutreachHumanReviewDecisionService(
    repository(requestRecord({ sendAuthorised: true })),
  );
  await assert.rejects(
    unauthorized.decide({ reviewRequestRecordId: 'review-request-1', decision: 'approved', reviewer: 'human_executive' }),
    /invalid authority state/,
  );

  const wrongEvent = createSalesGovernedOutreachHumanReviewDecisionService(
    repository({ ...requestRecord(), eventType: 'sales_governed_outreach_prepared' }),
  );
  await assert.rejects(
    wrongEvent.decide({ reviewRequestRecordId: 'review-request-1', decision: 'approved', reviewer: 'human_executive' }),
    /requires a governed outreach human review request/,
  );
});

test('blocks duplicate resolution', async () => {
  const service = createSalesGovernedOutreachHumanReviewDecisionService(
    repository(requestRecord(), { id: 'existing-resolution', clientId: null, projectId: null, eventType: 'sales_governed_outreach_human_review_resolved', actorType: 'founder', actorId: 'human_executive', payload: {}, createdAt: '2026-09-04T18:00:01.000Z' }),
  );
  await assert.rejects(
    service.decide({ reviewRequestRecordId: 'review-request-1', decision: 'approved', reviewer: 'human_executive' }),
    /already been resolved/,
  );
});
