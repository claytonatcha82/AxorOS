import test from 'node:test';
import assert from 'node:assert/strict';
import { createSalesSupervisedEmailExecutionService, type SalesEmailMessage } from './sales-supervised-email-execution-service.js';
import type { WorkflowEventRecord } from '../data/operational-repository.js';

function record(id: string, eventType: string, actorType: string, actorId: string | null, payload: unknown): WorkflowEventRecord {
  return { id, clientId: null, projectId: null, eventType, actorType, actorId, payload, createdAt: new Date().toISOString() };
}

function fixtures(overrides: Partial<Record<string, WorkflowEventRecord>> = {}) {
  const draft = record('draft-1', 'sales_internal_outreach_draft_recorded', 'agent', 'sales_agent', {
    leadId: 'lead-1', assessmentRecordId: 'assessment-1', salesIntakeExecutionId: 'intake-1',
    subject: 'Website opportunity', body: 'Hello from AxorOS', recipientEmail: 'owner@example.com',
    atlasSourcePaths: ['Volume 1 - Agency/06 Sales System/Sales Agent.md'],
    status: 'internal_review_required', humanReviewRequired: true, preparationOnly: true,
    outreachAuthorised: false, sendAuthorised: false, pricingAuthorised: false,
    commercialCommitmentAuthorised: false, nextAction: 'request_human_outreach_draft_review',
  });
  const gate = record('gate-1', 'sales_supervised_send_gate_recorded', 'founder', 'human_executive', {
    draftReviewRecordId: 'review-1', draftRecordId: 'draft-1', leadId: 'lead-1', decision: 'approved',
    approver: 'human_executive', supervised: true, outreachAuthorised: false, sendAuthorised: true,
    pricingAuthorised: false, commercialCommitmentAuthorised: false, nextAction: 'execute_supervised_email_send',
  });
  return new Map<string, WorkflowEventRecord>([
    ['draft-1', overrides['draft-1'] ?? draft],
    ['gate-1', overrides['gate-1'] ?? gate],
  ]);
}

function harness(events = fixtures()) {
  const sent: SalesEmailMessage[] = [];
  const created: any[] = [];
  const service = createSalesSupervisedEmailExecutionService(
    {
      async getWorkflowEventById(id) { return events.get(id) ?? null; },
      async createWorkflowEvent(input) {
        created.push(input);
        return record('sent-record-1', input.eventType, input.actorType, input.actorId ?? null, input.payload ?? {});
      },
    },
    {
      async send(message) { sent.push(message); return { providerMessageId: 'provider-message-1' }; },
    },
  );
  return { service, sent, created };
}

test('executes one supervised email from persisted approved authority and draft content', async () => {
  const { service, sent, created } = harness();
  const result = await service.execute('gate-1');
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0], { to: 'owner@example.com', subject: 'Website opportunity', body: 'Hello from AxorOS' });
  assert.equal(result.execution.humanSendApprovalVerified, true);
  assert.equal(result.execution.sendExecuted, true);
  assert.equal(result.execution.providerMessageId, 'provider-message-1');
  assert.equal(result.execution.pricingAuthorised, false);
  assert.equal(result.execution.commercialCommitmentAuthorised, false);
  assert.equal(created[0].eventType, 'sales_supervised_email_sent');
});

test('does not call transport when send gate is rejected', async () => {
  const events = fixtures();
  const gate = events.get('gate-1')!;
  events.set('gate-1', { ...gate, payload: { ...(gate.payload as object), decision: 'rejected', sendAuthorised: false, nextAction: 'return_to_outreach_review' } });
  const { service, sent } = harness(events);
  await assert.rejects(() => service.execute('gate-1'), /explicit human send approval|not authorised/);
  assert.equal(sent.length, 0);
});

test('does not call transport when send authority is forged without human provenance', async () => {
  const events = fixtures();
  const gate = events.get('gate-1')!;
  events.set('gate-1', { ...gate, actorType: 'agent', actorId: 'sales_agent' });
  const { service, sent } = harness(events);
  await assert.rejects(() => service.execute('gate-1'), /human executive send-gate provenance/);
  assert.equal(sent.length, 0);
});

test('does not call transport when gate and draft reference different leads', async () => {
  const events = fixtures();
  const gate = events.get('gate-1')!;
  events.set('gate-1', { ...gate, payload: { ...(gate.payload as object), leadId: 'lead-2' } });
  const { service, sent } = harness(events);
  await assert.rejects(() => service.execute('gate-1'), /different leads/);
  assert.equal(sent.length, 0);
});
