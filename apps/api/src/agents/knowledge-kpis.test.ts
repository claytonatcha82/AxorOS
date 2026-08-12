import assert from 'node:assert/strict';
import test from 'node:test';
import { knowledgeAcceptanceStatus, validateKnowledgeKpis, type KnowledgeAgentKpis } from './knowledge-kpis.js';

function passingKpis(): KnowledgeAgentKpis {
  return {
    retrievalAccuracy: 0.97, relevantDocumentPrecision: 0.96, missingInformationDetectionRate: 0.95,
    conflictDetectionRate: 0.95, averageRetrievalLatencyMs: 350, averageCostPerRetrieval: 0.002,
    averageContextSizeCharacters: 8000, citationAccuracy: 0.99, humanCorrectionRate: 0.02,
    unsupportedAnswerRate: 0.005, duplicateKnowledgeRetrievalRate: 0.01, humanEscalationRate: 0.08,
  };
}

test('valid Knowledge Agent KPIs pass structural validation', () => {
  assert.deepEqual(validateKnowledgeKpis(passingKpis()), []);
});

test('charter target profile passes acceptance governance', () => {
  const status = knowledgeAcceptanceStatus(passingKpis());
  assert.equal(status.passing, true);
  assert.deepEqual(status.failures, []);
});

test('weak retrieval unsupported answers and duplicates fail acceptance', () => {
  const kpis = passingKpis();
  kpis.retrievalAccuracy = 0.9;
  kpis.unsupportedAnswerRate = 0.02;
  kpis.duplicateKnowledgeRetrievalRate = 0.03;
  const status = knowledgeAcceptanceStatus(kpis);
  assert.equal(status.passing, false);
  assert.deepEqual(status.failures, ['correct_context_retrieval', 'unsupported_answers', 'duplicate_knowledge_retrieval']);
});
