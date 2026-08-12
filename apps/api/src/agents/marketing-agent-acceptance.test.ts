import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateMarketingAcceptanceSuite, MARKETING_AGENT_ACCEPTANCE_CASES } from './marketing-agent-acceptance.js';

test('marketing acceptance suite contains all six charter scenarios', () => {
  assert.deepEqual(MARKETING_AGENT_ACCEPTANCE_CASES.map((item) => item.id), ['case_study', 'monthly_calendar', 'declining_organic_traffic', 'agency_seo', 'multi_channel_project', 'stale_content']);
});

test('marketing foundation passes only when all scenarios are passed and verified', () => {
  const results = MARKETING_AGENT_ACCEPTANCE_CASES.map((item) => ({ caseId: item.id, passed: true, verified: true }));
  assert.deepEqual(evaluateMarketingAcceptanceSuite(results), { passing: true, failedCases: [] });
  results[2]!.passed = false;
  assert.deepEqual(evaluateMarketingAcceptanceSuite(results), { passing: false, failedCases: ['declining_organic_traffic'] });
});
