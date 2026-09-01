import assert from 'node:assert/strict';
import test from 'node:test';
import { createLeadAtlasResearchOrchestrator } from './lead-atlas-research-orchestrator.js';

const atlas = {} as never;
const createdAt = '2026-08-20T17:00:00.000Z';

function qualificationDependencies() {
  const persisted: Array<Record<string, unknown>> = [];
  const persistedDispositions: Array<Record<string, unknown>> = [];
  const runtimeReviews: Array<Record<string, unknown>> = [];
  const registeredReviews: Array<Record<string, unknown>> = [];
  return {
    persisted,
    persistedDispositions,
    runtimeReviews,
    registeredReviews,
    evidenceBuilder: { build() { return { businessFit: { score: 7, evidenceReferences: ['public-web:https://example.test/'], missingInformation: [] } }; } },
    qualificationService: { evaluate() { return { totalScore: null, suggestedStatus: 'insufficient_information', humanReviewRequired: true, missingInformation: ['More evidence required.'], atlasSourcePaths: ['Lead Qualification'] }; } },
    qualificationPersistence: { async persist(input: Record<string, unknown>) { persisted.push(input); return { id: `qualification-${persisted.length}` }; } },
    dispositionService: { evaluate(result: Record<string, unknown>) {
      assert.equal(result.suggestedStatus, 'insufficient_information');
      return {
        disposition: 'hold',
        recommendedAction: 'collect_more_evidence',
        humanApprovalRequired: true,
        reasons: ['Qualification evidence is incomplete; collect additional evidence before considering advance or rejection.', 'More evidence required.'],
        atlasSourcePaths: ['Lead Qualification'],
      };
    } },
    dispositionPersistence: { async persist(input: Record<string, unknown>) {
      persistedDispositions.push(input);
      return { id: `disposition-${persistedDispositions.length}`, createdAt };
    } },
    runtimeReviewService: { createTask(input: Record<string, unknown>) {
      runtimeReviews.push(input);
      return {
        taskId: input.taskId,
        executionId: input.executionId,
        originAgent: 'lead_agent',
        destinationAgent: 'lead_agent',
        approvalRequired: true,
        approvalOwner: 'human_executive',
        status: 'ready',
        nextAction: 'obtain_required_approval',
      };
    } },
    runtimeReviewRegistration: { async register(task: Record<string, unknown>) {
      registeredReviews.push(task);
      return { task };
    } },
  };
}

test('executes only Atlas-planned discovery queries and records a governed human-review runtime task after each persisted disposition', async () => {
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
      return { discovered: 1, enriched: [{ leadId: `lead-${calls.length}`, providerPlaceId: `place-${calls.length}`, companyName: 'Example Engineering', officialWebsiteUrl: 'https://example.test/', publicWebEvidence: [{ title: 'Example Engineering', url: 'https://example.test/', content: 'Engineering services.' }] }], proposals: [], outcomes: { enriched: 1, duplicateSkipped: 0, webResearchFailed: 0, unresolved: 0 } };
    },
  };
  const dependencies = qualificationDependencies();
  const result = await createLeadAtlasResearchOrchestrator(
    atlasContext as never,
    planner as never,
    workflow as never,
    dependencies.evidenceBuilder as never,
    dependencies.qualificationService as never,
    dependencies.qualificationPersistence as never,
    dependencies.dispositionService as never,
    dependencies.dispositionPersistence as never,
    dependencies.runtimeReviewService as never,
    dependencies.runtimeReviewRegistration as never,
  ).research({ geographicFocus: 'South Africa', country: 'south africa', maxQueries: 2, maxBusinessesPerQuery: 3, executionId: 'exec-1', correlationId: 'corr-1' });

  assert.equal(result.discovered, 2);
  assert.equal(result.enriched.length, 2);
  assert.deepEqual(result.outcomes, { enriched: 2, duplicateSkipped: 0, webResearchFailed: 0, unresolved: 0 });
  assert.equal(result.enriched[0]?.preliminaryQualification.suggestedStatus, 'insufficient_information');
  assert.equal(result.enriched[0]?.preliminaryQualification.humanReviewRequired, true);
  assert.equal(result.enriched[0]?.preliminaryQualificationRecordId, 'qualification-1');
  assert.equal(result.enriched[0]?.qualificationDisposition.disposition, 'hold');
  assert.equal(result.enriched[0]?.qualificationDisposition.recommendedAction, 'collect_more_evidence');
  assert.equal(result.enriched[0]?.qualificationDisposition.humanApprovalRequired, true);
  assert.equal(result.enriched[0]?.qualificationDispositionRecordId, 'disposition-1');
  assert.equal(result.enriched[0]?.qualificationReviewTaskId, 'lead-qualification-review-task:disposition-1');
  assert.equal(result.enriched[0]?.qualificationReviewExecutionId, 'lead-qualification-review:disposition-1');
  assert.equal(result.enriched[1]?.preliminaryQualificationRecordId, 'qualification-2');
  assert.equal(result.enriched[1]?.qualificationDispositionRecordId, 'disposition-2');
  assert.equal(result.enriched[1]?.qualificationReviewExecutionId, 'lead-qualification-review:disposition-2');
  assert.equal(dependencies.persisted.length, 2);
  assert.equal(dependencies.persistedDispositions.length, 2);
  assert.equal(dependencies.runtimeReviews.length, 2);
  assert.equal(dependencies.registeredReviews.length, 2);
  assert.equal(dependencies.persisted[0]?.leadId, 'lead-1');
  assert.equal(dependencies.persistedDispositions[0]?.qualificationRecordId, 'qualification-1');
  assert.equal((dependencies.persistedDispositions[0]?.disposition as Record<string, unknown>)?.recommendedAction, 'collect_more_evidence');
  assert.equal(dependencies.runtimeReviews[0]?.leadId, 'lead-1');
  assert.equal(dependencies.runtimeReviews[0]?.qualificationRecordId, 'qualification-1');
  assert.equal(dependencies.runtimeReviews[0]?.dispositionRecordId, 'disposition-1');
  assert.equal(dependencies.runtimeReviews[0]?.confidence, 1);
  assert.equal(dependencies.runtimeReviews[0]?.createdAt, createdAt);
  assert.equal(dependencies.registeredReviews[0]?.approvalRequired, true);
  assert.equal(dependencies.registeredReviews[0]?.approvalOwner, 'human_executive');
  assert.equal(dependencies.registeredReviews[0]?.nextAction, 'obtain_required_approval');
  assert.equal(calls.some((call) => /web design|website developer/i.test(String(call.query))), false);
  assert.equal(calls[0]?.executionId, 'exec-1:atlas-query-1');
  assert.equal(calls[1]?.executionId, 'exec-1:atlas-query-2');
});

test('fails before external research when Atlas context cannot be loaded', async () => {
  let workflowCalled = false;
  const atlasContext = { async load() { throw new Error('Required Atlas OS source was not retrieved: Ideal Client Profile.'); } };
  const planner = { plan() { throw new Error('planner should not run'); } };
  const workflow = { async research() { workflowCalled = true; return { discovered: 0, enriched: [], proposals: [], outcomes: { enriched: 0, duplicateSkipped: 0, webResearchFailed: 0, unresolved: 0 } }; } };
  const dependencies = qualificationDependencies();
  await assert.rejects(() => createLeadAtlasResearchOrchestrator(
    atlasContext as never,
    planner as never,
    workflow as never,
    dependencies.evidenceBuilder as never,
    dependencies.qualificationService as never,
    dependencies.qualificationPersistence as never,
    dependencies.dispositionService as never,
    dependencies.dispositionPersistence as never,
    dependencies.runtimeReviewService as never,
    dependencies.runtimeReviewRegistration as never,
  ).research({ executionId: 'exec-1', correlationId: 'corr-1' }), /Required Atlas OS source/);
  assert.equal(workflowCalled, false);
});

test('fails closed if an enriched lead reaches Atlas orchestration without the full governed qualification review pipeline', async () => {
  const atlasContext = { async load() { return atlas; } };
  const planner = { plan() { return { queries: ['Construction businesses'], atlasSourcePaths: ['Ideal Client Profile'] }; } };
  const workflow = { async research() { return { discovered: 1, enriched: [{ leadId: 'lead-1', providerPlaceId: 'place-1', companyName: 'Example', officialWebsiteUrl: 'https://example.test/', publicWebEvidence: [] }], proposals: [], outcomes: { enriched: 1, duplicateSkipped: 0, webResearchFailed: 0, unresolved: 0 } }; } };
  await assert.rejects(() => createLeadAtlasResearchOrchestrator(atlasContext as never, planner as never, workflow as never).research({ executionId: 'exec-1', correlationId: 'corr-1' }), /without a fully configured governed qualification review pipeline/);
});

test('rejects partially configured qualification dependencies at construction time', () => {
  const atlasContext = { async load() { return atlas; } };
  const planner = { plan() { return { queries: [], atlasSourcePaths: [] }; } };
  const workflow = { async research() { return { discovered: 0, enriched: [], proposals: [], outcomes: { enriched: 0, duplicateSkipped: 0, webResearchFailed: 0, unresolved: 0 } }; } };
  const { evidenceBuilder } = qualificationDependencies();
  assert.throws(() => createLeadAtlasResearchOrchestrator(atlasContext as never, planner as never, workflow as never, evidenceBuilder as never), /requires evidence builder, qualification service, qualification persistence, disposition service, disposition persistence, runtime review service, and runtime review registration together/);
});
