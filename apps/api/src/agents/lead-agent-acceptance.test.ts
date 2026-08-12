import assert from 'node:assert/strict';
import test from 'node:test';
import { LEAD_AGENT_ACCEPTANCE_SCENARIOS, evaluateLeadAcceptanceSuite } from './lead-agent-acceptance.js';

test('lead acceptance suite contains all six charter scenarios', () => {
  assert.deepEqual(LEAD_AGENT_ACCEPTANCE_SCENARIOS.map((scenario) => scenario.id), [
    'engineering_20', 'rank_opportunities', 'international_lead', 'excellent_construction_site', 'no_website', 'strong_site_poor_seo',
  ]);
});

test('all lead scenarios must pass duplicate hallucination and recommendation checks', () => {
  const results = LEAD_AGENT_ACCEPTANCE_SCENARIOS.map((scenario) => ({
    scenarioId: scenario.id, passed: true, noDuplicate: true, noHallucination: true, recommendationAppropriate: true,
  }));
  assert.deepEqual(evaluateLeadAcceptanceSuite(results), { passing: true, failedScenarios: [] });
});

test('any failed scenario blocks Lead Agent acceptance', () => {
  const results = LEAD_AGENT_ACCEPTANCE_SCENARIOS.map((scenario) => ({
    scenarioId: scenario.id, passed: true, noDuplicate: true, noHallucination: true, recommendationAppropriate: true,
  }));
  results[5]!.recommendationAppropriate = false;
  const outcome = evaluateLeadAcceptanceSuite(results);
  assert.equal(outcome.passing, false);
  assert.deepEqual(outcome.failedScenarios, ['strong_site_poor_seo']);
});
