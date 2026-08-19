import assert from 'node:assert/strict';
import test from 'node:test';
import { createLeadAtlasResearchOrchestrator } from './lead-atlas-research-orchestrator.js';

const atlas = {} as never;

function qualificationDependencies() {
  return {
    evidenceBuilder: { build() { return { businessFit: { score: 7, evidenceReferences: ['public-web:https://example.test/'], missingInformation: [] } }; } },
    qualificationService: { evaluate() { return { totalScore: null, suggestedStatus: 'insufficient_information', humanReviewRequired: true, missingInformation: ['More evidence required.'], atlasSourcePaths: ['Lead Qualification'] }; } },
  };
}

test('executes only Atlas-planned discovery queries and attaches preliminary qualification to enriched leads', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const atlasContext = { async load() { return atlas; } };
  const planner = {
    plan(input: Record<string, unknown>) {
      assert.equal(input.atlas, atlas);
      return { queries: ['Construction businesses in South Africa', 'Healthcare businesses in South Africa'], atlasSourcePaths: ['Ideal Client Profile'] };
    },
  };
  const workflow = {
    async research(input: Record<string, unknown>) {
      calls.push(input);
      return { discovered: 1, enriched: [{ leadId: `lead-${calls.length}`, providerPlaceId: `place-${calls.length}`, companyName: 'Example Engineering', officialWebsiteUrl: 'https://example.test/', publicWebEvidence: [{ title: 'Example Engineering', url: 'https://example.test/', content: 'Engineering services.' }] }], proposals: [] };
    },
  };
  const { evidenceBuilder, qualificationService } = qualificationDependencies();
  const result = await createLeadAtlasResearchOrchestrator(atlasContext as never, planner as never, workflow as never, evidenceBuilder as never, qualificationService as never).research({
    geographicFocus: 'South Africa', country: 'south africa', maxQueries: 2, maxBusinessesPerQuery: 3, executionId: 'exec-1', correlationId: 'corr-1',
  });

  assert.equal(result.discovered, 2);
  assert.equal(result.enriched.length, 2);
  assert.equal(result.enriched[0]?.preliminaryQualification.suggestedStatus, 'insufficient_information');
  assert.equal(result.enriched[0]?.preliminaryQualification.humanReviewRequired, true);
  assert.equal(calls.some((call) => /web design|website developer/i.test(String(call.query))), false);
  assert.equal(calls[0]?.executionId, 'exec-1:atlas-query-1');
  assert.equal(calls[1]?.executionId, 'exec-1:atlas-query-2');
});

test('fails before external research when Atlas context cannot be loaded', async () => {
  let workflowCalled = false;
  const atlasContext = { async load() { throw new Error('Required Atlas OS source was not retrieved: Ideal Client Profile.'); } };
  const planner = { plan() { throw new Error('planner should not run'); } };
  const workflow = { async research() { workflowCalled = true; return { discovered: 0, enriched: [], proposals: [] }; } };
  const { evidenceBuilder, qualificationService } = qualificationDependencies();
  await assert.rejects(() => createLeadAtlasResearchOrchestrator(atlasContext as never, planner as never, workflow as never, evidenceBuilder as never, qualificationService as never).research({ executionId: 'exec-1', correlationId: 'corr-1' }), /Required Atlas OS source/);
  assert.equal(workflowCalled, false);
});

test('fails closed if an enriched lead reaches Atlas orchestration without qualification services', async () => {
  const atlasContext = { async load() { return atlas; } };
  const planner = { plan() { return { queries: ['Construction businesses'], atlasSourcePaths: ['Ideal Client Profile'] }; } };
  const workflow = { async research() { return { discovered: 1, enriched: [{ leadId: 'lead-1', providerPlaceId: 'place-1', companyName: 'Example', officialWebsiteUrl: 'https://example.test/', publicWebEvidence: [] }], proposals: [] }; } };
  await assert.rejects(() => createLeadAtlasResearchOrchestrator(atlasContext as never, planner as never, workflow as never).research({ executionId: 'exec-1', correlationId: 'corr-1' }), /without a configured qualification pipeline/);
});
