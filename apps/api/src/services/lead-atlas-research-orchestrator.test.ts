import assert from 'node:assert/strict';
import test from 'node:test';
import { createLeadAtlasResearchOrchestrator } from './lead-atlas-research-orchestrator.js';

const atlas = {} as never;

test('executes only the discovery queries produced by the Atlas planner', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const atlasContext = { async load() { return atlas; } };
  const planner = {
    plan(input: Record<string, unknown>) {
      assert.equal(input.atlas, atlas);
      return {
        queries: ['Construction businesses in South Africa', 'Healthcare businesses in South Africa'],
        atlasSourcePaths: ['Volume 1 - Agency/02 - Agency Positioning/Ideal Client Profile.md.md'],
      };
    },
  };
  const workflow = {
    async research(input: Record<string, unknown>) {
      calls.push(input);
      return { discovered: 1, enriched: [], proposals: [] };
    },
  };

  const result = await createLeadAtlasResearchOrchestrator(atlasContext as never, planner as never, workflow as never).research({
    geographicFocus: 'South Africa',
    country: 'south africa',
    maxQueries: 2,
    maxBusinessesPerQuery: 3,
    executionId: 'exec-1',
    correlationId: 'corr-1',
  });

  assert.equal(result.discovered, 2);
  assert.deepEqual(result.queries, ['Construction businesses in South Africa', 'Healthcare businesses in South Africa']);
  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.query, 'Construction businesses in South Africa');
  assert.equal(calls[1]?.query, 'Healthcare businesses in South Africa');
  assert.equal(calls.some((call) => /web design|website developer/i.test(String(call.query))), false);
  assert.equal(calls[0]?.executionId, 'exec-1:atlas-query-1');
  assert.equal(calls[1]?.executionId, 'exec-1:atlas-query-2');
});

test('fails before external research when Atlas context cannot be loaded', async () => {
  let workflowCalled = false;
  const atlasContext = { async load() { throw new Error('Required Atlas OS source was not retrieved: Ideal Client Profile.'); } };
  const planner = { plan() { throw new Error('planner should not run'); } };
  const workflow = { async research() { workflowCalled = true; return { discovered: 0, enriched: [], proposals: [] }; } };

  await assert.rejects(
    () => createLeadAtlasResearchOrchestrator(atlasContext as never, planner as never, workflow as never).research({ executionId: 'exec-1', correlationId: 'corr-1' }),
    /Required Atlas OS source/,
  );
  assert.equal(workflowCalled, false);
});
