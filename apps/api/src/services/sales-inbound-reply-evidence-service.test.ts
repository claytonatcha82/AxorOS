import test from 'node:test';
import assert from 'node:assert/strict';
import { createSalesInboundReplyEvidenceService } from './sales-inbound-reply-evidence-service.js';

function detectedReply() {
  return {
    outboundRecordId: 'sent-record-1',
    leadId: 'lead-1',
    providerThreadReference: 'thread-1',
    outboundProviderMessageId: 'outbound-1',
    replyDetected: true,
    reply: {
      messageId: 'reply-1',
      threadReference: 'thread-1',
      from: 'Business Owner <owner@example.com>',
      to: 'sales@axoros.test',
      subject: 'Re: Website opportunity',
      internalDate: '2000',
      snippet: 'Thanks',
      textBody: 'Thanks, tell me more.',
    },
    automaticResponseAuthorised: false as const,
    nextAction: 'persist_inbound_reply_evidence' as const,
  };
}

test('persists detected reply evidence and preserves no automatic-response authority', async () => {
  const recorded: any[] = [];
  const service = createSalesInboundReplyEvidenceService(
    { async detect() { return detectedReply(); } },
    { async record(input) { recorded.push(input); return { ...input, recordedAt: '2026-08-21T12:00:00.000Z' }; } },
  );

  const result = await service.inspect('sent-record-1');
  assert.equal(recorded.length, 1);
  assert.deepEqual(recorded[0], {
    outboundRecordId: 'sent-record-1',
    leadId: 'lead-1',
    providerThreadReference: 'thread-1',
    providerMessageId: 'reply-1',
    senderAddress: 'Business Owner <owner@example.com>',
    recipientAddress: 'sales@axoros.test',
    subject: 'Re: Website opportunity',
    providerInternalDate: '2000',
    snippet: 'Thanks',
    textBody: 'Thanks, tell me more.',
  });
  assert.equal(result.replyDetected, true);
  assert.equal(result.evidenceRecorded, true);
  assert.equal(result.providerMessageId, 'reply-1');
  assert.equal(result.automaticResponseAuthorised, false);
  assert.equal(result.nextAction, 'classify_persisted_inbound_reply');
});

test('does not persist anything when no external reply is detected', async () => {
  let recordCalls = 0;
  const service = createSalesInboundReplyEvidenceService(
    { async detect() {
      return {
        outboundRecordId: 'sent-record-1', leadId: 'lead-1', providerThreadReference: 'thread-1',
        outboundProviderMessageId: 'outbound-1', replyDetected: false,
        automaticResponseAuthorised: false as const, nextAction: 'await_external_reply' as const,
      };
    } },
    { async record() { recordCalls += 1; throw new Error('should not record'); } },
  );

  const result = await service.inspect('sent-record-1');
  assert.equal(recordCalls, 0);
  assert.equal(result.replyDetected, false);
  assert.equal(result.evidenceRecorded, false);
  assert.equal(result.automaticResponseAuthorised, false);
  assert.equal(result.nextAction, 'await_external_reply');
});

test('propagates durable replay conflicts instead of pretending duplicate evidence was newly recorded', async () => {
  const service = createSalesInboundReplyEvidenceService(
    { async detect() { return detectedReply(); } },
    { async record() { throw new Error('Sales inbound Gmail message reply-1 has already been recorded.'); } },
  );

  await assert.rejects(() => service.inspect('sent-record-1'), /already been recorded/);
});
