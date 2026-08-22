import test from 'node:test';
import assert from 'node:assert/strict';
import type { WorkflowEventRecord } from '../data/operational-repository.js';
import type { GmailThreadEvidence } from '../integrations/gmail-draft-integration.js';
import { createSalesInboundReplyDetectionService } from './sales-inbound-reply-detection-service.js';

function outboundRecord(overrides: Record<string, unknown> = {}): WorkflowEventRecord {
  return {
    id: 'sent-record-1', clientId: null, projectId: null,
    eventType: 'sales_supervised_email_sent', actorType: 'agent', actorId: 'sales_agent',
    createdAt: '2026-08-21T10:00:00.000Z',
    payload: {
      sendGateRecordId: 'gate-1', draftRecordId: 'draft-1', leadId: 'lead-1',
      recipientEmail: 'owner@example.com', subject: 'Website opportunity',
      providerMessageId: 'outbound-1', providerThreadReference: 'thread-1',
      supervised: true, humanSendApprovalVerified: true, sendExecuted: true,
      pricingAuthorised: false, commercialCommitmentAuthorised: false,
      nextAction: 'record_outreach_and_monitor_response', ...overrides,
    },
  };
}

function thread(messages: GmailThreadEvidence['messages']): GmailThreadEvidence {
  return { threadReference: 'thread-1', messages };
}

function harness(record = outboundRecord(), evidence = thread([
  { messageId: 'outbound-1', threadReference: 'thread-1', from: 'sales@axoros.test', to: 'owner@example.com', internalDate: '1000', textBody: 'Outbound.' },
  { messageId: 'reply-1', threadReference: 'thread-1', from: 'Business Owner <owner@example.com>', to: 'sales@axoros.test', internalDate: '2000', textBody: 'Thanks, tell me more.' },
])) {
  const reads: string[] = [];
  const service = createSalesInboundReplyDetectionService(
    { async getWorkflowEventById(id) { return id === record.id ? record : null; } },
    { async readThread(reference) { reads.push(reference); return evidence; } },
  );
  return { service, reads };
}

test('detects a newer reply from the persisted outbound recipient on the exact Gmail thread', async () => {
  const { service, reads } = harness();
  const result = await service.detect('sent-record-1');
  assert.deepEqual(reads, ['thread-1']);
  assert.equal(result.replyDetected, true);
  assert.equal(result.reply?.messageId, 'reply-1');
  assert.equal(result.reply?.textBody, 'Thanks, tell me more.');
  assert.equal(result.automaticResponseAuthorised, false);
  assert.equal(result.nextAction, 'persist_inbound_reply_evidence');
});

test('accepts a newer Gmail delivery-status notification as provider inbound evidence', async () => {
  const evidence = thread([
    { messageId: 'outbound-1', threadReference: 'thread-1', from: 'sales@axoros.test', to: 'owner@example.com', internalDate: '1000' },
    {
      messageId: 'dsn-1', threadReference: 'thread-1',
      from: 'Mail Delivery Subsystem <mailer-daemon@example.test>', to: 'sales@axoros.test',
      internalDate: '2000', textBody: 'Delivery failed: address not found.',
      deliveryStatusNotification: true,
    },
  ]);
  const { service } = harness(outboundRecord(), evidence);
  const result = await service.detect('sent-record-1');
  assert.equal(result.replyDetected, true);
  assert.equal(result.reply?.messageId, 'dsn-1');
  assert.equal(result.reply?.deliveryStatusNotification, true);
  assert.equal(result.automaticResponseAuthorised, false);
  assert.equal(result.nextAction, 'persist_inbound_reply_evidence');
});

test('ignores later messages not sent by the persisted recipient', async () => {
  const evidence = thread([
    { messageId: 'outbound-1', threadReference: 'thread-1', from: 'sales@axoros.test', to: 'owner@example.com', internalDate: '1000' },
    { messageId: 'self-2', threadReference: 'thread-1', from: 'sales@axoros.test', to: 'owner@example.com', internalDate: '2000' },
    { messageId: 'other-1', threadReference: 'thread-1', from: 'someone-else@example.com', to: 'sales@axoros.test', internalDate: '3000' },
  ]);
  const { service } = harness(outboundRecord(), evidence);
  const result = await service.detect('sent-record-1');
  assert.equal(result.replyDetected, false);
  assert.equal(result.reply, undefined);
  assert.equal(result.nextAction, 'await_external_reply');
});

test('ignores bounce-like wording from an unrelated sender without Gmail delivery-status provenance', async () => {
  const evidence = thread([
    { messageId: 'outbound-1', threadReference: 'thread-1', from: 'sales@axoros.test', to: 'owner@example.com', internalDate: '1000' },
    {
      messageId: 'fake-bounce-1', threadReference: 'thread-1',
      from: 'someone-else@example.com', to: 'sales@axoros.test', internalDate: '2000',
      subject: 'Delivery Status Notification (Failure)', textBody: 'Delivery failed: mailbox unavailable.',
    },
  ]);
  const { service } = harness(outboundRecord(), evidence);
  const result = await service.detect('sent-record-1');
  assert.equal(result.replyDetected, false);
  assert.equal(result.reply, undefined);
  assert.equal(result.nextAction, 'await_external_reply');
});

test('ignores recipient messages that precede the persisted outbound message', async () => {
  const evidence = thread([
    { messageId: 'old-reply', threadReference: 'thread-1', from: 'owner@example.com', to: 'sales@axoros.test', internalDate: '500' },
    { messageId: 'outbound-1', threadReference: 'thread-1', from: 'sales@axoros.test', to: 'owner@example.com', internalDate: '1000' },
  ]);
  const { service } = harness(outboundRecord(), evidence);
  const result = await service.detect('sent-record-1');
  assert.equal(result.replyDetected, false);
});

test('fails closed when the recorded outbound Gmail message is absent from the thread', async () => {
  const evidence = thread([{ messageId: 'different-message', threadReference: 'thread-1', from: 'owner@example.com', internalDate: '2000' }]);
  const { service } = harness(outboundRecord(), evidence);
  await assert.rejects(() => service.detect('sent-record-1'), /outbound Gmail message is not present/);
});

test('fails closed when provider thread correlation is missing', async () => {
  const { service, reads } = harness(outboundRecord({ providerThreadReference: undefined }));
  await assert.rejects(() => service.detect('sent-record-1'), /providerThreadReference is required/);
  assert.equal(reads.length, 0);
});

test('rejects records that are not completed supervised Sales sends', async () => {
  const { service, reads } = harness(outboundRecord({ humanSendApprovalVerified: false }));
  await assert.rejects(() => service.detect('sent-record-1'), /completed supervised Sales send/);
  assert.equal(reads.length, 0);
});
