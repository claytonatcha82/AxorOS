import test from 'node:test';
import assert from 'node:assert/strict';
import { createSalesSupervisedEmailExecutionService, type SalesEmailMessage, type SalesEmailSendContext } from './sales-supervised-email-execution-service.js';
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
    approver: 'human_executive', supervised: true, outreachAuthorised: true, sendAuthorised: true,
    pricingAuthorised: false, commercialCommitmentAuthorised: false, nextAction: 'execute_supervised_email_send',
  });
  return new Map<string, WorkflowEventRecord>([
    ['draft-1', overrides['draft-1'] ?? draft],
    ['gate-1', overrides['gate-1'] ?? gate],
  ]);
}

function attempt(gateId: string, draftId: string, leadId: string, idempotencyKey: string, status: 'reserved' | 'sent' | 'failed') {
  const timestamp = new Date().toISOString();
  return {
    sendGateRecordId: gateId,
    draftRecordId: draftId,
    leadId,
    idempotencyKey,
    status,
    reservedAt: timestamp,
    updatedAt: timestamp,
  };
}

function harness(events = fixtures(), transportError?: Error, suppressedRecipients: string[] = []) {
  const sent: SalesEmailMessage[] = [];
  const contexts: SalesEmailSendContext[] = [];
  const created: any[] = [];
  const reservations: Array<{ gateId: string; draftId: string; leadId: string; idempotencyKey: string }> = [];
  const markedSent: Array<{ gateId: string; providerMessageId: string }> = [];
  const markedFailed: Array<{ gateId: string; errorMessage: string }> = [];
  const reserved = new Set<string>();
  const suppressed = new Set(suppressedRecipients.map((address) => address.toLowerCase()));

  const service = createSalesSupervisedEmailExecutionService(
    {
      async getWorkflowEventById(id) { return events.get(id) ?? null; },
      async createWorkflowEvent(input) {
        created.push(input);
        return record('sent-record-1', input.eventType, input.actorType, input.actorId ?? null, input.payload ?? {});
      },
    },
    {
      async send(message, context) {
        sent.push(message);
        contexts.push(context);
        if (transportError) throw transportError;
        return { providerMessageId: 'provider-message-1', providerThreadReference: 'gmail-thread-1' };
      },
    },
    {
      async reserve(gateId, draftId, leadId, idempotencyKey) {
        if (reserved.has(gateId)) throw new Error(`Sales email send gate ${gateId} already has a durable send attempt.`);
        reserved.add(gateId);
        reservations.push({ gateId, draftId, leadId, idempotencyKey });
        return attempt(gateId, draftId, leadId, idempotencyKey, 'reserved');
      },
      async markSent(gateId, providerMessageId) {
        markedSent.push({ gateId, providerMessageId });
        const result = attempt(gateId, 'draft-1', 'lead-1', `sales-supervised-email-send:${gateId}`, 'sent');
        return { ...result, providerMessageId, completedAt: new Date().toISOString() };
      },
      async markFailed(gateId, errorMessage) {
        markedFailed.push({ gateId, errorMessage });
        const result = attempt(gateId, 'draft-1', 'lead-1', `sales-supervised-email-send:${gateId}`, 'failed');
        return { ...result, errorMessage, completedAt: new Date().toISOString() };
      },
    },
    {
      async isActiveForRecipient(recipientAddress) {
        return suppressed.has(recipientAddress.toLowerCase());
      },
    },
  );

  return { service, sent, contexts, created, reservations, markedSent, markedFailed };
}

test('executes one supervised email from persisted approved authority and draft content', async () => {
  const { service, sent, contexts, created, reservations, markedSent, markedFailed } = harness();
  const result = await service.execute('gate-1');
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0], { to: 'owner@example.com', subject: 'Website opportunity', body: 'Hello from AxorOS' });
  assert.deepEqual(contexts[0], {
    sendGateRecordId: 'gate-1',
    executionId: 'sales-supervised-email-send:gate-1',
    correlationId: 'lead-1',
    idempotencyKey: 'sales-supervised-email-send:gate-1',
  });
  assert.deepEqual(reservations, [{
    gateId: 'gate-1',
    draftId: 'draft-1',
    leadId: 'lead-1',
    idempotencyKey: 'sales-supervised-email-send:gate-1',
  }]);
  assert.deepEqual(markedSent, [{ gateId: 'gate-1', providerMessageId: 'provider-message-1' }]);
  assert.equal(markedFailed.length, 0);
  assert.equal(result.execution.humanSendApprovalVerified, true);
  assert.equal(result.execution.sendExecuted, true);
  assert.equal(result.execution.providerMessageId, 'provider-message-1');
  assert.equal(result.execution.providerThreadReference, 'gmail-thread-1');
  assert.equal(result.execution.pricingAuthorised, false);
  assert.equal(result.execution.commercialCommitmentAuthorised, false);
  assert.equal(created[0].eventType, 'sales_supervised_email_sent');
  assert.equal(created[0].payload.providerThreadReference, 'gmail-thread-1');
});

test('blocks replay before a second transport call', async () => {
  const { service, sent } = harness();
  await service.execute('gate-1');
  await assert.rejects(() => service.execute('gate-1'), /already has a durable send attempt/);
  assert.equal(sent.length, 1);
});

test('marks a reserved attempt failed when transport execution fails', async () => {
  const { service, sent, markedSent, markedFailed, created } = harness(fixtures(), new Error('provider unavailable'));
  await assert.rejects(() => service.execute('gate-1'), /provider unavailable/);
  assert.equal(sent.length, 1);
  assert.equal(markedSent.length, 0);
  assert.deepEqual(markedFailed, [{ gateId: 'gate-1', errorMessage: 'provider unavailable' }]);
  assert.equal(created.length, 0);
});

test('blocks an actively suppressed recipient before reservation or provider execution', async () => {
  const { service, sent, reservations, created } = harness(fixtures(), undefined, ['OWNER@example.com']);
  await assert.rejects(() => service.execute('gate-1'), /active outreach suppression/);
  assert.equal(sent.length, 0);
  assert.equal(reservations.length, 0);
  assert.equal(created.length, 0);
});

test('does not call transport when send gate is rejected', async () => {
  const events = fixtures();
  const gate = events.get('gate-1')!;
  events.set('gate-1', { ...gate, payload: { ...(gate.payload as object), decision: 'rejected', sendAuthorised: false, nextAction: 'return_to_outreach_review' } });
  const { service, sent, reservations } = harness(events);
  await assert.rejects(() => service.execute('gate-1'), /explicit human send approval|not authorised/);
  assert.equal(sent.length, 0);
  assert.equal(reservations.length, 0);
});

test('does not call transport when send authority is forged without human provenance', async () => {
  const events = fixtures();
  const gate = events.get('gate-1')!;
  events.set('gate-1', { ...gate, actorType: 'agent', actorId: 'sales_agent' });
  const { service, sent, reservations } = harness(events);
  await assert.rejects(() => service.execute('gate-1'), /human executive send-gate provenance/);
  assert.equal(sent.length, 0);
  assert.equal(reservations.length, 0);
});

test('does not call transport when gate and draft reference different leads', async () => {
  const events = fixtures();
  const gate = events.get('gate-1')!;
  events.set('gate-1', { ...gate, payload: { ...(gate.payload as object), leadId: 'lead-2' } });
  const { service, sent, reservations } = harness(events);
  await assert.rejects(() => service.execute('gate-1'), /different leads/);
  assert.equal(sent.length, 0);
  assert.equal(reservations.length, 0);
});
