import assert from 'node:assert/strict';
import test from 'node:test';
import { KNOWLEDGE_AGENT_ACCEPTANCE_CASES, evaluateKnowledgeAcceptanceSuite } from './knowledge-agent-acceptance.js';

test('acceptance suite contains all six charter retrieval tests', () => {
  assert.deepEqual(KNOWLEDGE_AGENT_ACCEPTANCE_CASES.map((item) => item.id), [
    'technology_stack', 'international_clients', 'pre_deployment', 'finance_access', 'client_onboarding', 'pricing_conflicts',
  ]);
});

test('knowledge acceptance requires every test to pass document section interpretation citation and hallucination checks', () => {
  const results = KNOWLEDGE_AGENT_ACCEPTANCE_CASES.map((item) => ({
    caseId: item.id, correctDocument: true, correctSection: true, correctInterpretation: true, correctCitations: true, noHallucination: true,
  }));
  assert.deepEqual(evaluateKnowledgeAcceptanceSuite(results), { passing: true, failedCases: [] });
});

test('one unsupported or hallucinated retrieval prevents acceptance', () => {
  const results = KNOWLEDGE_AGENT_ACCEPTANCE_CASES.map((item) => ({
    caseId: item.id, correctDocument: true, correctSection: true, correctInterpretation: true, correctCitations: true, noHallucination: true,
  }));
  results[2]!.noHallucination = false;
  const outcome = evaluateKnowledgeAcceptanceSuite(results);
  assert.equal(outcome.passing, false);
  assert.deepEqual(outcome.failedCases, ['pre_deployment']);
});
