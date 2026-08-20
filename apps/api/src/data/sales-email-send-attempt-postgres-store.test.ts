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
    idempotency_key: 'sales-email-send:gate-1',
    status: 'reserved',
    provider_message_id: null,
    error_message: null,
    created_at: new Date('2026-08-20T19:00:00.000Z'),
    updated_at: new Date('2026-08-20T19:00:00.000Z'),
    ...overrides,
  };
}

test('reserve creates a durable reserved Sales email send attempt', async () => {
  const calls: { sql: string; values: unknown[] }[] = [];
  const store = new SalesEmailSendAttemptPostgresStore({
    async query(sql: string, values?: readonly unknown[]): Promise<QueryResult> {
      calls.push({ sql, values: [...(values ?? [])] });
      return { rows: [persistedAttempt()] };
    },
  } as never);

  const attempt = await store.reserve('gate-1', 'sales-email-send:gate-1');

  assert.equal(attempt.sendGateRecordId, 'gate-1');
  assert.equal(attempt.idempotencyKey, 'sales-email-send:gate-1');
  assert.equal(attempt.status, 'reserved');
  assert.equal(attempt.providerMessageId, undefined);
  assert.equal(attempt.errorMessage, undefined);
  assert.deepEqual(calls[0]?.values, ['gate-1', 'sales-email-send:gate-1']);
  assert.match(calls[0]?.sql ?? '', /on conflict do nothing/i);
});

test('reserve rejects a send gate that already has a durable attempt', async () => {
  const store = new SalesEmailSendAttemptPostgresStore({
    async query(): Promise<QueryResult> {
      return { rows: [] };
    },
  } as never);

  await assert.rejects(
    () => store.reserve('gate-1', 'sales-email-send:gate-1'),
    (error: unknown) => error instanceof SalesEmailSendAttemptConflictError
      && error.sendGateRecordId === 'gate-1',
  );
});

test('markSent only transitions a reserved attempt and preserves provider evidence', async () => {
  const store = new SalesEmailSendAttemptPostgresStore({
    async query(): Promise<QueryResult> {
      return {
        rows: [persistedAttempt({
          status: 'sent',
          provider_message_id: 'gmail-message-123',
          updated_at: new Date('2026-08-20T19:01:00.000Z'),
        })],
      };
    },
  } as never);

  const attempt = await store.markSent('gate-1', 'gmail-message-123');
  assert.equal(attempt.status, 'sent');
  assert.equal(attempt.providerMessageId, 'gmail-message-123');
  assert.equal(attempt.errorMessage, undefined);
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
  const store = new SalesEmailSendAttemptPostgresStore({
    async query(): Promise<QueryResult> {
      return {
        rows: [persistedAttempt({
          status: 'failed',
          error_message: 'provider timeout',
          updated_at: new Date('2026-08-20T19:01:00.000Z'),
        })],
      };
    },
  } as never);

  const attempt = await store.markFailed('gate-1', 'provider timeout');
  assert.equal(attempt.status, 'failed');
  assert.equal(attempt.providerMessageId, undefined);
  assert.equal(attempt.errorMessage, 'provider timeout');
});
