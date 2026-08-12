import assert from 'node:assert/strict';
import test from 'node:test';
import {
  confidenceAction,
  validateKnowledgeAgentRequest,
  validateKnowledgeAgentResult,
  type KnowledgeAgentRequest,
  type KnowledgeAgentResult,
} from './knowledge-agent-contracts.js';

test('knowledge agent request requires a requesting agent task and knowledge domains', () => {
  const valid: KnowledgeAgentRequest = {
    requestId: 'req-001', requestingAgent: 'production_agent', task: 'Build a five-page website',
    requiredContext: ['development standards', 'SEO standards'], maximumClassification: 'internal',
  };
  assert.deepEqual(validateKnowledgeAgentRequest(valid), []);
  assert.ok(validateKnowledgeAgentRequest({ ...valid, requiredContext: [] }).includes('requiredContext must contain at least one knowledge domain.'));
});

test('confidence thresholds follow the approved knowledge charter', () => {
  assert.equal(confidenceAction(0.95), 'continue');
  assert.equal(confidenceAction(0.8), 'continue_with_uncertainty');
  assert.equal(confidenceAction(0.6), 'request_additional_information');
  assert.equal(confidenceAction(0.4), 'escalate');
  assert.throws(() => confidenceAction(1.2), /between 0 and 1/);
});

test('knowledge result requires traceable citations and bounded relevance', () => {
  const result: KnowledgeAgentResult = {
    requestId: 'req-001', confidence: 0.94,
    documents: [{ documentId: 'doc-1', title: 'Website Production SOP', version: '1', relevance: 0.96, classification: 'internal', citation: 'Volume 6/Website Production SOP' }],
    keyInformation: ['Use approved production workflow.'], conflictsFound: [], missingInformation: [], recommendedFollowup: [], citations: ['Volume 6/Website Production SOP'],
  };
  assert.deepEqual(validateKnowledgeAgentResult(result), []);
  result.documents[0]!.citation = '';
  assert.ok(validateKnowledgeAgentResult(result).includes('every returned document requires a citation.'));
});
