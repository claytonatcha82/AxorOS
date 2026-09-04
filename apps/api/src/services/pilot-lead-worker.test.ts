import assert from 'node:assert/strict';
import test from 'node:test';
import { createPilotLeadWorker } from './pilot-lead-worker.js';

const disabled = {
  state: 'PILOT_DISABLED' as const,
  changedBy: 'test',
  reason: 'test',
  version: 1,
  changedAt: new Date(0).toISOString(),
};

const active = {
  ...disabled,
  state: 'PILOT_ACTIVE' as const,
  version: 2,
};

const queryState = {};

const emptyOutcomes = () => ({
  enriched: 0,
  duplicateSkipped: 0,
  webResearchFailed: 0,
  unresolved: 0,
  ambiguous: 0,
  notFound: 0,
  skipped: 0,
});

test('PILOT_DISABLED prevents all Lead research execution', async () => {
  let calls = 0;
  const worker = createPilotLeadWorker(
    { async get() { return disabled; } },
    { async research() { calls += 1; throw new Error('must not execute'); } },
    { intervalMs: 60_000 },
  );

  const result = await worker.runOnce();
  assert.equal(result, null);
  assert.equal(calls, 0);
});

test('PILOT_ACTIVE allows the bounded expanded discovery plan to reach the orchestrator', async () => {
  const inputs: unknown[] = [];
  const output = { queries: Array.from({ length: 12 }, (_, index) => `q${index + 1}`), atlasSourcePaths: ['atlas.md'], discovered: 1, enriched: [], proposals: [], outcomes: { ...emptyOutcomes(), duplicateSkipped: 1 }, updatedQueryState: queryState };
  const worker = createPilotLeadWorker(
    { async get() { return active; } },
    { async research(input) { inputs.push(input); return output; } },
    { intervalMs: 60_000 },
  );

  assert.equal(await worker.runOnce(), output);
  assert.equal(inputs.length, 1);
  assert.equal((inputs[0] as any).maxQueries, 12);
  assert.equal((inputs[0] as any).maxBusinessesPerQuery, 3);
  assert.equal((inputs[0] as any).maxWebResultsPerBusiness, 3);
});

test('explicit maxQueries overrides the bounded default', async () => {
  let captured: any;
  const output = { queries: [], atlasSourcePaths: [], discovered: 0, enriched: [], proposals: [], outcomes: emptyOutcomes(), updatedQueryState: queryState };
  const worker = createPilotLeadWorker(
    { async get() { return active; } },
    { async research(input) { captured = input; return output; } },
    { intervalMs: 60_000, maxQueries: 2 },
  );
  await worker.runOnce();
  assert.equal(captured.maxQueries, 2);
});

test('second state check prevents execution if pilot is disabled before provider boundary', async () => {
  let stateCalls = 0;
  let researchCalls = 0;
  const worker = createPilotLeadWorker(
    {
      async get() {
        stateCalls += 1;
        return stateCalls === 1 ? active : disabled;
      },
    },
    { async research() { researchCalls += 1; throw new Error('must not execute'); } },
    { intervalMs: 60_000 },
  );

  assert.equal(await worker.runOnce(), null);
  assert.equal(researchCalls, 0);
});

test('concurrent runOnce calls do not overlap research cycles', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let calls = 0;
  const output = { queries: [], atlasSourcePaths: [], discovered: 0, enriched: [], proposals: [], outcomes: emptyOutcomes(), updatedQueryState: queryState };
  const worker = createPilotLeadWorker(
    { async get() { return active; } },
    {
      async research() {
        calls += 1;
        await gate;
        return output;
      },
    },
    { intervalMs: 60_000 },
  );

  const first = worker.runOnce();
  await new Promise((resolve) => setImmediate(resolve));
  const second = await worker.runOnce();
  assert.equal(second, null);
  assert.equal(calls, 1);
  release();
  assert.equal(await first, output);
});

test('exposes live worker activity and completion timestamps', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const output = { queries: [], atlasSourcePaths: [], discovered: 0, enriched: [], proposals: [], outcomes: emptyOutcomes(), updatedQueryState: queryState };
  const worker = createPilotLeadWorker(
    { async get() { return active; } },
    { async research() { await gate; return output; } },
    { intervalMs: 60_000 },
  );

  const run = worker.runOnce();
  await new Promise((resolve) => setImmediate(resolve));
  const activeStatus = worker.getStatus();
  assert.equal(activeStatus.inProgress, true);
  assert.ok(activeStatus.lastStartedAt);
  assert.equal(activeStatus.lastOutcome, null);

  release();
  await run;
  const completedStatus = worker.getStatus();
  assert.equal(completedStatus.inProgress, false);
  assert.equal(completedStatus.lastOutcome, 'completed');
  assert.ok(completedStatus.lastCompletedAt);
  assert.equal(completedStatus.lastFailedAt, null);
  assert.deepEqual(completedStatus.lastSummary, { discovered: 0, enriched: 0, duplicateSkipped: 0, webResearchFailed: 0, unresolved: 0, ambiguous: 0, notFound: 0, queriesExhausted: 0 });
});

test('preserves nextPageToken across query state load and save', async () => {
  const loadedState = {
    query: {
      exhausted: false,
      lastAttemptedAt: '2026-09-03T16:00:00.000Z',
      nextPageToken: 'token_123',
    },
  };
  let savedState: any;
  const queryStore = {
    async get() {
      return loadedState;
    },
    async save(state: any) {
      savedState = state;
    },
  };
  const output = {
    queries: ['query'],
    atlasSourcePaths: ['atlas.md'],
    discovered: 0,
    enriched: [],
    proposals: [],
    outcomes: emptyOutcomes(),
    updatedQueryState: {
      query: {
        exhausted: false,
        lastAttemptedAt: '2026-09-03T17:00:00.000Z',
        nextPageToken: 'token_456',
      },
    },
  };
  const inputs: any[] = [];
  const worker = createPilotLeadWorker(
    { async get() { return active; } },
    { async research(input) { inputs.push(input); return output; } },
    { intervalMs: 60_000 },
    queryStore,
  );

  await worker.runOnce();

  assert.equal(inputs[0]?.queryState.query.nextPageToken, 'token_123');
  assert.equal(savedState.query.nextPageToken, 'token_456');
});
