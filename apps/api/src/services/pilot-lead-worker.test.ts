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

test('PILOT_ACTIVE executes one bounded South Africa research cycle', async () => {
  const inputs: unknown[] = [];
  const output = { queries: ['q'], atlasSourcePaths: ['atlas.md'], discovered: 1, enriched: [], proposals: [] };
  const worker = createPilotLeadWorker(
    { async get() { return active; } },
    { async research(input) { inputs.push(input); return output; } },
    { intervalMs: 60_000 },
  );

  assert.equal(await worker.runOnce(), output);
  assert.equal(inputs.length, 1);
  assert.deepEqual(
    {
      geographicFocus: (inputs[0] as any).geographicFocus,
      maxQueries: (inputs[0] as any).maxQueries,
      maxBusinessesPerQuery: (inputs[0] as any).maxBusinessesPerQuery,
      maxWebResultsPerBusiness: (inputs[0] as any).maxWebResultsPerBusiness,
    },
    {
      geographicFocus: 'South Africa',
      maxQueries: 1,
      maxBusinessesPerQuery: 3,
      maxWebResultsPerBusiness: 3,
    },
  );
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
  const output = { queries: [], atlasSourcePaths: [], discovered: 0, enriched: [], proposals: [] };
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
