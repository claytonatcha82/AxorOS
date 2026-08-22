import assert from 'node:assert/strict';
import test from 'node:test';
import type { LeadSalesHandoffEligibility } from './lead-sales-handoff-eligibility-service.js';
import { createLeadSalesIntakeTaskService } from './lead-sales-intake-task-service.js';

const eligibility: LeadSalesHandoffEligibility = {
  eligible: true,
  leadId: 'lead-1',
  qualificationRecordId: 'qualification-1',
  dispositionRecordId: 'disposition-1',
  reviewExecutionId: 'lead-qualification-review:disposition-1',
  reviewTaskId: 'lead-qualification-review-task:disposition-1',
  recommendedAction: 'approve_advance',
  humanApprovalActor: 'human_executive',
  atlasSourcePaths: ['Volume 1 - Agency/05 Client Acquisition/Lead Qualification.md'],
};

test('creates a queued Sales intake-only task from human-approved eligibility', () => {
  const task = createLeadSalesIntakeTaskService().createTask({
    taskId: 'sales-intake-task:eligibility-1',
    executionId: 'sales-intake:eligibility-1',
    correlationId: 'corr-1',
    eligibilityRecordId: 'eligibility-1',
    eligibility,
    createdAt: '2026-08-20T17:40:00.000Z',
  });

  assert.equal(task.originAgent, 'lead_agent');
  assert.equal(task.destinationAgent, 'sales_agent');
  assert.equal(task.status, 'queued');
  assert.equal(task.nextAction, 'configure_governed_sales_intake_processing');
  assert.equal(task.approvalRequired, false);
  assert.equal(task.inputs.salesIntakeOnly, true);
  assert.equal(task.inputs.salesDispatchAuthorised, false);
  assert.equal(task.inputs.outreachAuthorised, false);
  assert.equal(task.context.eligibilityRecordId, 'eligibility-1');
  assert.deepEqual(task.knowledgeReferences, eligibility.atlasSourcePaths);
});

test('Sales intake task cannot be created without human executive approval', () => {
  assert.throws(
    () => createLeadSalesIntakeTaskService().createTask({
      taskId: 'task', executionId: 'execution', correlationId: 'corr', eligibilityRecordId: 'eligibility',
      eligibility: { ...eligibility, humanApprovalActor: 'lead_agent' as never }, createdAt: '2026-08-20T17:40:00.000Z',
    }),
    /human executive approval/i,
  );
});

test('Sales intake task cannot be created for a non-advance recommendation', () => {
  assert.throws(
    () => createLeadSalesIntakeTaskService().createTask({
      taskId: 'task', executionId: 'execution', correlationId: 'corr', eligibilityRecordId: 'eligibility',
      eligibility: { ...eligibility, recommendedAction: 'review_fit' as never }, createdAt: '2026-08-20T17:40:00.000Z',
    }),
    /approve_advance/i,
  );
});

test('Sales intake task requires Atlas provenance', () => {
  assert.throws(
    () => createLeadSalesIntakeTaskService().createTask({
      taskId: 'task', executionId: 'execution', correlationId: 'corr', eligibilityRecordId: 'eligibility',
      eligibility: { ...eligibility, atlasSourcePaths: [] }, createdAt: '2026-08-20T17:40:00.000Z',
    }),
    /Atlas source paths/i,
  );
});
