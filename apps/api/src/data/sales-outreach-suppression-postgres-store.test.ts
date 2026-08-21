import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SalesOutreachSuppressionConflictError,
  SalesOutreachSuppressionPostgresStore,
} from './sales-outreach-suppression-postgres-store.js';

function row() {
  return {
    lead_id: 'lead-1',
    recipient_address: 'prospect@example.com',
    reason: 'explicit_opt_out',
    source_inbound_evidence_id: 'evidence-1',
    source_provider_message_id: 'message-1',
    active: true,
    suppressed_at: new Date('2026-08-21T13:00:00.000Z'),
  };
}

test('records an active explicit opt-out suppression with normalized recipient', async () => {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const store = new SalesOutreachSuppressionPostgresStore({
    async query(sql: string, params?: unknown[]) {
      calls.push({ sql, params: params ?? [] });
      return { rows: [row()], command: 'INSERT', rowCount: 1, oid: 0, fields: [] } as any;
    },
  } as any);

  const record = await store.record({
    leadId: 'lead-1',
    recipientAddress: ' Prospect@Example.com ',
    reason: 'explicit_opt_out',
    sourceInboundEvidenceId: 'evidence-1',
    sourceProviderMessageId: 'message-1',
  });

  assert.equal(record.active, true);
  assert.equal(record.recipientAddress, 'prospect@example.com');
  assert.equal(record.reason, 'explicit_opt_out');
  assert.deepEqual(calls[0]!.params, [
    'lead-1',
    'prospect@example.com',
    'explicit_opt_out',
    'evidence-1',
    'message-1',
  ]);
});

test('fails closed when suppression insert conflicts', async () => {
  const store = new SalesOutreachSuppressionPostgresStore({
    async query() {
      return { rows: [], command: 'INSERT', rowCount: 0, oid: 0, fields: [] } as any;
    },
  } as any);

  await assert.rejects(
    store.record({
      leadId: 'lead-1',
      recipientAddress: 'prospect@example.com',
      reason: 'explicit_opt_out',
      sourceInboundEvidenceId: 'evidence-1',
      sourceProviderMessageId: 'message-1',
    }),
    SalesOutreachSuppressionConflictError,
  );
});

test('checks active suppression by normalized recipient address', async () => {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const store = new SalesOutreachSuppressionPostgresStore({
    async query(sql: string, params?: unknown[]) {
      calls.push({ sql, params: params ?? [] });
      return { rows: [{ exists: true }], command: 'SELECT', rowCount: 1, oid: 0, fields: [] } as any;
    },
  } as any);

  const active = await store.isActiveForRecipient(' Prospect@Example.com ');
  assert.equal(active, true);
  assert.deepEqual(calls[0]!.params, ['prospect@example.com']);
});

test('rejects missing suppression provenance before database write', async () => {
  let called = false;
  const store = new SalesOutreachSuppressionPostgresStore({
    async query() {
      called = true;
      return { rows: [], command: 'INSERT', rowCount: 0, oid: 0, fields: [] } as any;
    },
  } as any);

  await assert.rejects(
    store.record({
      leadId: 'lead-1',
      recipientAddress: 'prospect@example.com',
      reason: 'explicit_opt_out',
      sourceInboundEvidenceId: ' ',
      sourceProviderMessageId: 'message-1',
    }),
    /sourceInboundEvidenceId is required/,
  );
  assert.equal(called, false);
});
