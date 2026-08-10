import assert from 'node:assert/strict';
import test from 'node:test';
import { createKnowledgeContextService } from './knowledge-context-service.js';
import type { KnowledgeRetrievalItem } from './knowledge-retrieval-service.js';

function item(index: number, content: string): KnowledgeRetrievalItem {
  return {
    content,
    score: 1 - index / 10,
    citation: {
      documentId: `db-${index}`,
      documentKey: `doc-${index}`,
      title: `Document ${index}`,
      path: `Volume ${index}/Document ${index}.md`,
      headingPath: ['Section'],
      chunkId: `chunk-${index}`,
      chunkIndex: index,
      chunkType: 'section',
      authorityLevel: index === 0 ? 'authoritative' : 'reference',
      securityClassification: 'internal',
      sourceVersion: 'commit-123',
      documentChecksum: `doc-checksum-${index}`,
      chunkChecksum: `chunk-checksum-${index}`,
    },
  };
}

test('assembles ordered Atlas context with stable references and provenance', async () => {
  const retrieval = {
    async retrieve() {
      return [item(0, 'Primary guidance.'), item(1, 'Secondary guidance.')];
    },
  };

  const service = createKnowledgeContextService(retrieval);
  const result = await service.assemble({
    query: 'website delivery',
    agent: 'production_agent',
    task: 'website_development',
    maximumSecurityClassification: 'internal',
  });

  assert.equal(result.includedItems, 2);
  assert.equal(result.truncated, false);
  assert.match(result.context, /\[ATLAS-01\] Document 0/);
  assert.match(result.context, /\[ATLAS-02\] Document 1/);
  assert.equal(result.sources[0]?.reference, '[ATLAS-01]');
  assert.equal(result.sources[0]?.citation.path, 'Volume 0/Document 0.md');
});

test('enforces a deterministic context character budget', async () => {
  const retrieval = {
    async retrieve() {
      return [item(0, 'A'.repeat(800)), item(1, 'B'.repeat(800))];
    },
  };

  const service = createKnowledgeContextService(retrieval);
  const result = await service.assemble({
    query: 'website',
    agent: 'production_agent',
    task: 'website_development',
    maximumSecurityClassification: 'internal',
    maxCharacters: 1_000,
  });

  assert.equal(result.includedItems, 1);
  assert.equal(result.truncated, true);
  assert.ok(result.characterCount <= 1_000);
});

test('rejects unsafe context budgets', async () => {
  const service = createKnowledgeContextService({ async retrieve() { return []; } });

  await assert.rejects(
    () => service.assemble({
      query: 'website',
      agent: 'production_agent',
      task: 'website_development',
      maximumSecurityClassification: 'internal',
      maxCharacters: 50_000,
    }),
    /maxCharacters must be an integer between 1000 and 40000/,
  );
});
