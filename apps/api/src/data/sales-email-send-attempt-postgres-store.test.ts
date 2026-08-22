import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SalesEmailSendAttemptConflictError,
  SalesEmailSendAttemptPostgresStore,
} from './sales-email-send-attempt-postgres-store.js';

type QueryResult = { rows: Record<string, unknown>[]; rowCount?: number };

function persistedAttempt(overrides: Record<string, unknown> = {}) {
  return {
    send_gate_record_id: 'gate-1',
    draft_record_id: 'draft-1',
    lead_id: 'lead-1',
    idempotency_key: 'sales-email-send:gate-1',
    status: 'reserved',
    provider_message_id: null,
    error_message: null,
    reserved_at: new Date('2026-08-20T19:00:00.000Z'),
    completed_at: null,
    updated_at: new Date('2026-08-20T19:00:00.000Z'),
    ...overrides,
  };
}

test('reserve creates a durable reserved Sales email send attempt with draft and lead provenance', async () => {
  const calls: { sql: string; values: unknown[] }[] = [];
  const store = new SalesEmailSendAttemptPostgresStore({
    async query(sql: string, values?: readonly unknown[]): Promise<QueryResult> {
      calls.push({ sql, values: [...(values ?? [])] });
      return { rows: [persistedAttempt()] };
    },
  } as never);

  const attempt = await store.reserve('gate-1', 'draft-1', 'lead-1', 'sales-email-send:gate-1');

  assert.equal(attempt.sendGateRecordId, 'gate-1');
  assert.equal(attempt.draftRecordId, 'draft-1');
  assert.equal(attempt.leadId, 'lead-1');
  assert.equal(attempt.idempotencyKey, 'sales-email-send:gate-1');
  assert.equal(attempt.status, 'reserved');
  assert.equal(attempt.providerMessageId, undefined);
  assert.equal(attempt.errorMessage, undefined);
  assert.equal(attempt.reservedAt, '2026-08-20T19:00:00.000Z');
  assert.equal(attempt.completedAt, undefined);
  assert.deepEqual(calls[0]?.values, ['gate-1', 'draft-1', 'lead-1', 'sales-email-send:gate-1']);
  assert.match(calls[0]?.sql ?? '', /draft_record_id/i);
  assert.match(calls[0]?.sql ?? '', /lead_id/i);
  assert.match(calls[0]?.sql ?? '', /reserved_at/i);
  assert.match(calls[0]?.sql ?? '', /on conflict do nothing/i);
});

test('reserve rejects a send gate that already has a durable attempt', async () => {
  const store = new SalesEmailSendAttemptPostgresStore({
    async query(): Promise<QueryResult> {
      return { rows: [] };
    },
  } as never);

  await assert.rejects(
    () => store.reserve('gate-1', 'draft-1', 'lead-1', 'sales-email-send:gate-1'),
    (error: unknown) => error instanceof SalesEmailSendAttemptConflictError
      && error.sendGateRecordId === 'gate-1',
  );
});

test('markSent only transitions a reserved attempt and preserves provider evidence', async () => {
  let updateSql = '';
  const store = new SalesEmailSendAttemptPostgresStore({
    async query(sql: string): Promise<QueryResult> {
      updateSql = sql;
      return {
        rows: [persistedAttempt({
          status: 'sent',
          provider_message_id: 'gmail-message-123',
          completed_at: new Date('2026-08-20T19:01:00.000Z'),
          updated_at: new Date('2026-08-20T19:01:00.000Z'),
        })],
      };
    },
  } as never);

  const attempt = await store.markSent('gate-1', 'gmail-message-123');
  assert.equal(attempt.status, 'sent');
  assert.equal(attempt.providerMessageId, 'gmail-message-123');
  assert.equal(attempt.errorMessage, undefined);
  assert.equal(attempt.completedAt, '2026-08-20T19:01:00.000Z');
  assert.match(updateSql, /completed_at = now\(\)/i);
});

test('markSent rejects attempts that are no longer reserved', async () => {
  const store = new SalesEmailSendAttemptPostgresStore({
    async query(): Promise<QueryResult> {
      return { rows: [] };
    },
  } as never);

  await assert.rejects(
    () => store.markSent('gate-1', 'gmail-message-123'),
    /is not reservable as sent/,
  );
});

test('markFailed only transitions a reserved attempt and records failure evidence', async () => {
  let updateSql = '';
  const store = new SalesEmailSendAttemptPostgresStore({
    async query(sql: string): Promise<QueryResult> {
      updateSql = sql;
      return {
        rows: [persistedAttempt({
          status: 'failed',
          error_message: 'provider timeout',
          completed_at: new Date('2026-08-20T19:01:00.000Z'),
          updated_at: new Date('2026-08-20T19:01:00.000Z'),
        })],
      };
    },
  } as never);

  const attempt = await store.markFailed('gate-1', 'provider timeout');
  assert.equal(attempt.status, 'failed');
  assert.equal(attempt.providerMessageId, undefined);
  assert.equal(attempt.errorMessage, 'provider timeout');
  assert.equal(attempt.completedAt, '2026-08-20T19:01:00.000Z');
  assert.match(updateSql, /completed_at = now\(\)/i);
});
