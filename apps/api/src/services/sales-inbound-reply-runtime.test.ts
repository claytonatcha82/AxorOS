import assert from 'node:assert/strict';
import test from 'node:test';
import type { Pool } from 'pg';
import { createPersistedSalesInboundReplyRuntime } from './sales-inbound-reply-runtime.js';

function workflowRow() {
  return {
    id: 'sent-record-1', client_id: null, project_id: null,
    event_type: 'sales_supervised_email_sent', actor_type: 'agent', actor_id: 'sales_agent',
    payload: {
      leadId: 'lead-1', recipientEmail: 'owner@example.com', providerMessageId: 'outbound-1',
      providerThreadReference: 'thread-1', supervised: true, humanSendApprovalVerified: true, sendExecuted: true,
    },
    created_at: new Date('2026-08-21T12:00:00.000Z'),
  };
}

test('composes persisted repository with the configured Gmail thread reader for inspection', async () => {
  const queries: string[] = [];
  const pool = {
    async query(sql: string) {
      queries.push(sql);
      if (/from operational\.workflow_events where id = \$1/i.test(sql)) {
        return { rows: [workflowRow()] };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  } as unknown as Pool;
  const reads: string[] = [];
  const gmail = {
    async readThread(threadReference: string) {
      reads.push(threadReference);
      return {
        threadReference,
        messages: [
          { messageId: 'outbound-1', threadReference, from: 'sales@axoros.test', to: 'owner@example.com', internalDate: '1000' },
          { messageId: 'reply-1', threadReference, from: 'owner@example.com', to: 'sales@axoros.test', internalDate: '2000', textBody: 'Interested.' },
        ],
      };
    },
  };

  const runtime = createPersistedSalesInboundReplyRuntime(pool, gmail);
  const result = await runtime.commands.inspect('sent-record-1');

  assert.equal(queries.length, 1);
  assert.deepEqual(reads, ['thread-1']);
  assert.equal(result.replyDetected, true);
  assert.equal(result.reply?.messageId, 'reply-1');
  assert.equal(result.automaticResponseAuthorised, false);
});
