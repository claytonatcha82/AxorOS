import test from 'node:test';
import assert from 'node:assert/strict';
import { SalesInboundReplyEvidenceConflictError, SalesInboundReplyEvidencePostgresStore } from './sales-inbound-reply-evidence-postgres-store.js';

function row() {
  return {
    outbound_record_id: 'sent-record-1', lead_id: 'lead-1', provider_thread_reference: 'thread-1',
    provider_message_id: 'reply-1', sender_address: 'owner@example.com', recipient_address: 'sales@axoros.test',
    subject: 'Re: Website opportunity', provider_internal_date: '2000', snippet: 'Thanks', text_body: 'Thanks, tell me more.',
    recorded_at: new Date('2026-08-21T12:00:00.000Z'),
  };
}

const input = {
  outboundRecordId: 'sent-record-1', leadId: 'lead-1', providerThreadReference: 'thread-1',
  providerMessageId: 'reply-1', senderAddress: 'owner@example.com', recipientAddress: 'sales@axoros.test',
  subject: 'Re: Website opportunity', providerInternalDate: '2000', snippet: 'Thanks', textBody: 'Thanks, tell me more.',
};

test('persists inbound Gmail reply evidence with provider message replay protection', async () => {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const store = new SalesInboundReplyEvidencePostgresStore({
    async query(sql: string, params?: unknown[]) {
      calls.push({ sql, params: params ?? [] });
      return { rows: [row()], command: 'INSERT', rowCount: 1, oid: 0, fields: [] } as any;
    },
  } as any);

  const result = await store.record(input);
  assert.equal(result.providerMessageId, 'reply-1');
  assert.equal(result.textBody, 'Thanks, tell me more.');
  assert.equal(result.recordedAt, '2026-08-21T12:00:00.000Z');
  assert.match(calls[0]!.sql, /on conflict do nothing/i);
  assert.deepEqual(calls[0]!.params.slice(0, 4), ['sent-record-1', 'lead-1', 'thread-1', 'reply-1']);
});

test('fails closed when the same provider message cannot be inserted again', async () => {
  const store = new SalesInboundReplyEvidencePostgresStore({
    async query() { return { rows: [], command: 'INSERT', rowCount: 0, oid: 0, fields: [] } as any; },
  } as any);

  await assert.rejects(() => store.record(input), (error: unknown) => {
    assert.ok(error instanceof SalesInboundReplyEvidenceConflictError);
    assert.match(error.message, /already been recorded/);
    return true;
  });
});
