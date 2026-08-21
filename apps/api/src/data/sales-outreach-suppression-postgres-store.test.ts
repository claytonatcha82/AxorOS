import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SalesOutreachSuppressionConflictError,
  SalesOutreachSuppressionPostgresStore,
} from './sales-outreach-suppression-postgres-store.js';

test('records an active explicit opt-out suppression with normalized recipient', async () => {
  const calls: Array<{ text: string; values?: unknown[] }> = [];
  const pool = {
    async query<Row>(text: string, values?: unknown[]) {
      calls.push({ text, values });
      return {
        rows: [{
          lead_id: 'lead-1',
          recipient_address: 'prospect@example.com',
          reason: 'explicit_opt_out',
          source_inbound_evidence_id: 'evidence-1',
          source_provider_message_id: 'message-1',
          active: true,
          suppressed_at: '2026-08-21T13:00:00.000Z',
        } as Row],
      };
    },
  };

  const store = new SalesOutreachSuppressionPostgresStore(pool);
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
  assert.deepEqual(calls[0]?.values, [
    'lead-1',
    'prospect@example.com',
    'explicit_opt_out',
    'evidence-1',
    'message-1',
  ]);
});

test('fails closed when suppression insert conflicts', async () => {
  const pool = {
    async query<Row>() {
      return { rows: [] as Row[] };
    },
  };
  const store = new SalesOutreachSuppressionPostgresStore(pool);

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
  const calls: Array<{ text: string; values?: unknown[] }> = [];
  const pool = {
    async query<Row>(text: string, values?: unknown[]) {
      calls.push({ text, values });
      return { rows: [{ exists: true } as Row] };
    },
  };
  const store = new SalesOutreachSuppressionPostgresStore(pool);

  const active = await store.isActiveForRecipient(' Prospect@Example.com ');
  assert.equal(active, true);
  assert.deepEqual(calls[0]?.values, ['prospect@example.com']);
});

test('rejects missing suppression provenance before database write', async () => {
  let called = false;
  const pool = {
    async query<Row>() {
      called = true;
      return { rows: [] as Row[] };
    },
  };
  const store = new SalesOutreachSuppressionPostgresStore(pool);

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
