import assert from 'node:assert/strict';
import test from 'node:test';
import { detectKnowledgeConflict, operationalKnowledgeAllowed, rankKnowledgeCandidates, suppressDuplicateKnowledge, type KnowledgeCandidate } from './knowledge-governance.js';

const base: KnowledgeCandidate = {
  documentId: 'doc-1', title: 'Standard', authority: 'atlas_standard', freshness: 'current', relevance: 0.9,
  version: '1.0', topicKey: 'pricing', contentFingerprint: 'abc',
};

test('Atlas authority outranks lower-authority sources even when relevance is similar', () => {
  const ranked = rankKnowledgeCandidates([
    { ...base, documentId: 'external', authority: 'approved_external', relevance: 0.99 },
    { ...base, documentId: 'governance', authority: 'atlas_governance', relevance: 0.8 },
  ]);
  assert.equal(ranked[0]!.documentId, 'governance');
});

test('current knowledge outranks review due and deprecated knowledge within same authority', () => {
  const ranked = rankKnowledgeCandidates([
    { ...base, documentId: 'old', freshness: 'deprecated', relevance: 1 },
    { ...base, documentId: 'current', freshness: 'current', relevance: 0.7 },
  ]);
  assert.equal(ranked[0]!.documentId, 'current');
  assert.equal(operationalKnowledgeAllowed(ranked[1]!), false);
});

test('duplicate knowledge is suppressed by topic and content fingerprint', () => {
  const result = suppressDuplicateKnowledge([base, { ...base, documentId: 'doc-2' }]);
  assert.equal(result.length, 1);
});

test('conflicting guidance is escalated instead of guessed', () => {
  const conflict = detectKnowledgeConflict(base, { ...base, documentId: 'doc-2', contentFingerprint: 'different' });
  assert.equal(conflict?.conflictDetected, true);
  assert.equal(conflict?.recommendedAction, 'knowledge_governance_review');
});
