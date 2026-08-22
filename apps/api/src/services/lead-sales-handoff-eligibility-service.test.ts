import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentRuntimeExecutionRecord, AgentRuntimeEvent } from '../agents/agent-runtime-state.js';
import { createLeadSalesHandoffEligibilityService } from './lead-sales-handoff-eligibility-service.js';

function record(overrides: Partial<AgentRuntimeExecutionRecord['task']> = {}): AgentRuntimeExecutionRecord {
  const now = '2026-08-20T17:30:00.000Z';
  return {
    task: {
      taskId: 'lead-qualification-review-task:disposition-1',
      executionId: 'lead-qualification-review:disposition-1',
      originAgent: 'lead_agent',
      destinationAgent: 'lead_agent',
      objective: 'Obtain human review of the Atlas-backed lead qualification disposition.',
      priority: 'normal',
      context: {
        leadId: 'lead-1',
        qualificationRecordId: 'qualification-1',
        dispositionRecordId: 'disposition-1',
      },
      knowledgeReferences: ['Volume 1 - Agency/05 Client Acquisition/Lead Qualification.md'],
      inputs: {
        leadId: 'lead-1',
        qualificationRecordId: 'qualification-1',
        dispositionRecordId: 'disposition-1',
        disposition: 'hold',
        recommendedAction: 'approve_advance',
        reasons: ['Atlas-backed preliminary qualification suggests good fit, but human approval is required before advancing the lead.'],
      },
      expectedOutput: 'A governed human approval decision for the recorded lead qualification disposition.',
      dependencies: [],
      risks: ['Human approval required.'],
      confidence: 1,
      approvalRequired: false,
      approvalOwner: 'human_executive',
      status: 'ready',
      nextAction: 'execute_destination_capability',
      attempt: 1,
      maxAttempts: 1,
      correlationId: 'corr-1',
      createdAt: now,
      updatedAt: now,
      ...overrides,
    },
    version: 4,
    persistedAt: now,
  };
}

function events(options: { actor?: string; includeRequested?: boolean; includeGranted?: boolean } = {}): AgentRuntimeEvent[] {
  const base = {
    executionId: 'lead-qualification-review:disposition-1',
    taskId: 'lead-qualification-review-task:disposition-1',
    correlationId: 'corr-1',
    actor: 'runtime' as const,
    occurredAt: '2026-08-20T17:31:00.000Z',
  };
  const result: AgentRuntimeEvent[] = [];
  if (options.includeRequested ?? true) {
    result.push({
      ...base,
      eventId: 'event-requested',
      type: 'approval_requested',
      payload: { approvalOwner: 'human_executive' },
      idempotencyKey: 'runtime:review:approval-requested',
    });
  }
  if (options.includeGranted ?? true) {
    result.push({
      ...base,
      eventId: 'event-granted',
      type: 'approval_granted',
      payload: { actor: options.actor ?? 'human_executive' },
      idempotencyKey: 'runtime:review:approval-approved',
    });
  }
  return result;
}

function store(runtimeRecord: AgentRuntimeExecutionRecord, runtimeEvents: AgentRuntimeEvent[]) {
  return {
    async getExecution(executionId: string) {
      return executionId === runtimeRecord.task.executionId ? runtimeRecord : null;
    },
    async listEvents(executionId: string) {
      return executionId === runtimeRecord.task.executionId ? runtimeEvents : [];
    },
  };
}

test('marks a human-approved approve_advance review as eligible for controlled Sales handoff', async () => {
  const eligibility = await createLeadSalesHandoffEligibilityService(store(record(), events())).evaluate(
    'lead-qualification-review:disposition-1',
  );

  assert.deepEqual(eligibility, {
    eligible: true,
    leadId: 'lead-1',
    qualificationRecordId: 'qualification-1',
    dispositionRecordId: 'disposition-1',
    reviewExecutionId: 'lead-qualification-review:disposition-1',
    reviewTaskId: 'lead-qualification-review-task:disposition-1',
    recommendedAction: 'approve_advance',
    humanApprovalActor: 'human_executive',
    atlasSourcePaths: ['Volume 1 - Agency/05 Client Acquisition/Lead Qualification.md'],
  });
});

test('rejects a review that has not been approved back to ready', async () => {
  const service = createLeadSalesHandoffEligibilityService(store(record({ status: 'review', approvalRequired: true }), events({ includeGranted: false })));
  await assert.rejects(() => service.evaluate('lead-qualification-review:disposition-1'), /approved ready status/i);
});

test('rejects approval evidence that is not from the human executive', async () => {
  const service = createLeadSalesHandoffEligibilityService(store(record(), events({ actor: 'executive_agent' })));
  await assert.rejects(() => service.evaluate('lead-qualification-review:disposition-1'), /human executive approval/i);
});

test('rejects non-advance recommendations even after human review', async () => {
  const service = createLeadSalesHandoffEligibilityService(store(record({ inputs: { disposition: 'hold', recommendedAction: 'collect_more_evidence' } }), events()));
  await assert.rejects(() => service.evaluate('lead-qualification-review:disposition-1'), /approve_advance recommendation/i);
});

test('rejects any attempt to bypass the conservative hold provenance', async () => {
  const service = createLeadSalesHandoffEligibilityService(store(record({ inputs: { disposition: 'advance', recommendedAction: 'approve_advance' } }), events()));
  await assert.rejects(() => service.evaluate('lead-qualification-review:disposition-1'), /conservative hold disposition/i);
});

test('requires Atlas provenance before Sales handoff eligibility can be established', async () => {
  const service = createLeadSalesHandoffEligibilityService(store(record({ knowledgeReferences: [] }), events()));
  await assert.rejects(() => service.evaluate('lead-qualification-review:disposition-1'), /Atlas source paths/i);
});
