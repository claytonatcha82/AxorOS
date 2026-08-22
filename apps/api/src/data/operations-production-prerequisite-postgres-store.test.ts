import assert from 'node:assert/strict';
import test from 'node:test';
import type { Pool } from 'pg';
import {
  OperationsProductionPrerequisiteIntegrityConflictError,
  OperationsProductionPrerequisitePostgresStore,
} from './operations-production-prerequisite-postgres-store.js';

const base = {
  eventType: 'operations_contract_signed_verified',
  commercialRecordReference: 'commercial:test:1',
  evidenceReference: 'contract-provider:test:1',
  observedAt: '2026-08-22T09:00:00.000Z',
};

function persistedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'workflow-event:1',
    client_id: null,
    project_id: null,
    event_type: base.eventType,
    actor_type: 'agent',
    actor_id: 'operations_agent',
    payload: {
      commercialRecordReference: base.commercialRecordReference,
      verified: true,
      evidenceReference: base.evidenceReference,
      observedAt: base.observedAt,
    },
    created_at: new Date('2026-08-22T09:01:00.000Z'),
    ...overrides,
  };
}

function poolHarness(existing: Record<string, unknown> | null = null) {
  const statements: string[] = [];
  let insertCount = 0;
  let selected = existing;
  const client = {
    async query(sql: string, values: readonly unknown[] = []) {
      statements.push(sql);
      if (sql === 'begin' || sql === 'commit' || sql === 'rollback') return { rowCount: 0, rows: [] };
      if (sql.includes('pg_advisory_xact_lock')) {
        assert.equal(values[0], `operations-production-prerequisite:${base.evidenceReference}`);
        return { rowCount: 1, rows: [{ pg_advisory_xact_lock: null }] };
      }
      if (sql.includes('from operational.workflow_events')) {
        return { rowCount: selected ? 1 : 0, rows: selected ? [selected] : [] };
      }
      if (sql.includes('insert into operational.workflow_events')) {
        insertCount += 1;
        selected = persistedRow({ payload: JSON.parse(String(values[1])) as unknown });
        return { rowCount: 1, rows: [selected] };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
    release() {},
  };
  return {
    pool: { async connect() { return client; } } as unknown as Pick<Pool, 'connect'>,
    statements,
    get insertCount() { return insertCount; },
  };
}

test('Operations prerequisite store inserts once and exact replay returns the original authoritative event', async () => {
  const harness = poolHarness();
  const store = new OperationsProductionPrerequisitePostgresStore(harness.pool);

  const first = await store.record(base);
  const replay = await store.record(base);

  assert.equal(first.id, 'workflow-event:1');
  assert.equal(replay.id, first.id);
  assert.equal(harness.insertCount, 1);
  const firstLockIndex = harness.statements.findIndex((sql) => sql.includes('pg_advisory_xact_lock'));
  const firstSelectIndex = harness.statements.findIndex((sql) => sql.includes('from operational.workflow_events'));
  assert.ok(firstLockIndex >= 0 && firstLockIndex < firstSelectIndex);
});

test('Operations prerequisite store fails closed when evidence reference is rebound to another commercial record', async () => {
  const harness = poolHarness(persistedRow());
  const store = new OperationsProductionPrerequisitePostgresStore(harness.pool);

  await assert.rejects(
    () => store.record({ ...base, commercialRecordReference: 'commercial:other' }),
    OperationsProductionPrerequisiteIntegrityConflictError,
  );
  assert.equal(harness.insertCount, 0);
  assert.ok(harness.statements.includes('rollback'));
});

test('Operations prerequisite store fails closed when evidence reference is reused for another prerequisite', async () => {
  const harness = poolHarness(persistedRow());
  const store = new OperationsProductionPrerequisitePostgresStore(harness.pool);

  await assert.rejects(
    () => store.record({ ...base, eventType: 'operations_onboarding_complete' }),
    OperationsProductionPrerequisiteIntegrityConflictError,
  );
  assert.equal(harness.insertCount, 0);
});

test('Operations prerequisite store fails closed when an evidence identity is replayed with different observation data', async () => {
  const harness = poolHarness(persistedRow());
  const store = new OperationsProductionPrerequisitePostgresStore(harness.pool);

  await assert.rejects(
    () => store.record({ ...base, observedAt: '2026-08-22T10:00:00.000Z' }),
    OperationsProductionPrerequisiteIntegrityConflictError,
  );
  assert.equal(harness.insertCount, 0);
});
