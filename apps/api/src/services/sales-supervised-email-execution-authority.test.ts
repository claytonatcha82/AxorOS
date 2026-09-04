import assert from 'node:assert/strict';
import test from 'node:test';

import { createSalesSupervisedEmailExecutionService } from './sales-supervised-email-execution-service.js';

function repository(events: Record<string, any>) {
  return {
    async getWorkflowEventById(id: string) { return events[id] ?? null; },
    async createWorkflowEvent(input: any) { return { id: 'sent-event', ...input }; },
  };
}

function sendGate(overrides: Record<string, unknown> = {}) {
  return {
    id: 'send-gate-1',
    eventType: 'sales_supervised_send_gate_recorded',
    actorType: 'founder',
    actorId: 'human_executive',
    payload: {
      decision: 'approved',
      approver: 'human_executive',
      supervised: true,
      sendAuthorised: true,
      outreachAuthorised: true,
      dispatchAuthorised: false,
      pricingAuthorised: false,
      commercialCommitmentAuthorised: false,
      nextAction: 'execute_supervised_email_send',
      draftRecordId: 'prep-1',
      leadId: 'lead-1',
      ...overrides,
    },
  };
}

const preparation = {
  id: 'prep-1',
  eventType: 'sales_governed_outreach_prepared',
  actorType: 'agent',
  actorId: 'sales_agent',
  payload: {
    leadId: 'lead-1',
    status: 'prepared_for_human_review',
    preparationOnly: true,
    outreachAuthorised: true,
    dispatchAuthorised: false,
    sendAuthorised: false,
    pricingAuthorised: false,
    commercialCommitmentAuthorised: false,
    humanReviewRequired: true,
    recipientEmail: 'prospect@example.com',
    subject: 'AxorOS',
    body: 'Hello',
  },
};

function dependencies() {
  let sent = 0;
  const timestamp = () => new Date().toISOString();
  return {
    transport: {
      async send() {
        sent += 1;
        return { providerMessageId: 'provider-1', providerThreadReference: 'thread-1' };
      },
    },
    sendAttempts: {
      async reserve(sendGateRecordId: string, draftRecordId: string, leadId: string, idempotencyKey: string) {
        return { sendGateRecordId, draftRecordId, leadId, idempotencyKey, status: 'reserved' as const, reservedAt: timestamp(), updatedAt: timestamp() };
      },
      async markSent(sendGateRecordId: string, providerMessageId: string) {
        return { sendGateRecordId, draftRecordId: 'prep-1', leadId: 'lead-1', idempotencyKey: `sales-supervised-email-send:${sendGateRecordId}`, status: 'sent' as const, providerMessageId, reservedAt: timestamp(), completedAt: timestamp(), updatedAt: timestamp() };
      },
      async markFailed(sendGateRecordId: string, errorMessage: string) {
        return { sendGateRecordId, draftRecordId: 'prep-1', leadId: 'lead-1', idempotencyKey: `sales-supervised-email-send:${sendGateRecordId}`, status: 'failed' as const, errorMessage, reservedAt: timestamp(), completedAt: timestamp(), updatedAt: timestamp() };
      },
    },
    get sendCount() { return sent; },
  };
}

test('only a persisted human-approved send gate can reach the transport', async () => {
  const deps = dependencies();
  const service = createSalesSupervisedEmailExecutionService(
    repository({ 'send-gate-1': sendGate(), 'prep-1': preparation }),
    deps.transport,
    deps.sendAttempts,
  );

  const result = await service.execute('send-gate-1');
  assert.equal(result.execution.humanSendApprovalVerified, true);
  assert.equal(result.execution.sendExecuted, true);
  assert.equal(deps.sendCount, 1);
});

test('a gate without outreach authority cannot reach the transport', async () => {
  const deps = dependencies();
  const service = createSalesSupervisedEmailExecutionService(
    repository({ 'send-gate-1': sendGate({ outreachAuthorised: false }), 'prep-1': preparation }),
    deps.transport,
    deps.sendAttempts,
  );

  await assert.rejects(() => service.execute('send-gate-1'), /explicit outreach-only authority|outreach-only authority|authorised for email execution/);
  assert.equal(deps.sendCount, 0);
});

test('a gate with dispatch authority cannot reach the transport', async () => {
  const deps = dependencies();
  const service = createSalesSupervisedEmailExecutionService(
    repository({ 'send-gate-1': sendGate({ dispatchAuthorised: true }), 'prep-1': preparation }),
    deps.transport,
    deps.sendAttempts,
  );

  await assert.rejects(() => service.execute('send-gate-1'));
  assert.equal(deps.sendCount, 0);
});

test('a gate with pricing authority cannot reach the transport', async () => {
  const deps = dependencies();
  const service = createSalesSupervisedEmailExecutionService(
    repository({ 'send-gate-1': sendGate({ pricingAuthorised: true }), 'prep-1': preparation }),
    deps.transport,
    deps.sendAttempts,
  );

  await assert.rejects(() => service.execute('send-gate-1'));
  assert.equal(deps.sendCount, 0);
});

test('a gate with commercial commitment authority cannot reach the transport', async () => {
  const deps = dependencies();
  const service = createSalesSupervisedEmailExecutionService(
    repository({ 'send-gate-1': sendGate({ commercialCommitmentAuthorised: true }), 'prep-1': preparation }),
    deps.transport,
    deps.sendAttempts,
  );

  await assert.rejects(() => service.execute('send-gate-1'));
  assert.equal(deps.sendCount, 0);
});
