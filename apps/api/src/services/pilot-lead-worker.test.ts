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
  const output = { queries: ['q1', 'q2', 'q3', 'q4', 'q5', 'q6'], atlasSourcePaths: ['atlas.md'], discovered: 1, enriched: [], proposals: [], outcomes: { enriched: 0, duplicateSkipped: 1, webResearchFailed: 0, unresolved: 0, ambiguous: 0, notFound: 0 } };
  const worker = createPilotLeadWorker(
    { async get() { return active; } },
    { async research(input) { inputs.push(input); return output; } },
    { intervalMs: 60_000 },
  );

  assert.equal(await worker.runOnce(), output);
  assert.equal(inputs.length, 1);
  assert.equal((inputs[0] as any).maxQueries, 6);
  assert.equal((inputs[0] as any).maxBusinessesPerQuery, 3);
  assert.equal((inputs[0] as any).maxWebResultsPerBusiness, 3);
});

test('explicit maxQueries overrides the bounded default', async () => {
  let captured: any;
  const output = { queries: [], atlasSourcePaths: [], discovered: 0, enriched: [], proposals: [], outcomes: { enriched: 0, duplicateSkipped: 0, webResearchFailed: 0, unresolved: 0, ambiguous: 0, notFound: 0 } };
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
  const output = { queries: [], atlasSourcePaths: [], discovered: 0, enriched: [], proposals: [], outcomes: { enriched: 0, duplicateSkipped: 0, webResearchFailed: 0, unresolved: 0, ambiguous: 0, notFound: 0 } };
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
  const output = { queries: [], atlasSourcePaths: [], discovered: 0, enriched: [], proposals: [], outcomes: { enriched: 0, duplicateSkipped: 0, webResearchFailed: 0, unresolved: 0, ambiguous: 0, notFound: 0 } };
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
  assert.deepEqual(completedStatus.lastSummary, { discovered: 0, enriched: 0, duplicateSkipped: 0, webResearchFailed: 0, unresolved: 0, ambiguous: 0, notFound: 0 });
});
