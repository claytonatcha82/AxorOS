import assert from 'node:assert/strict';
import test from 'node:test';
import { createKnowledgeRetrievalService } from './knowledge-retrieval-service.js';
import type { KnowledgeSearchInput, KnowledgeSearchResult } from './knowledge-repository.js';

const sampleResult: KnowledgeSearchResult = {
  chunkId: 'chunk-1',
  documentId: 'db-doc-1',
  documentKey: 'atlas-doc-1',
  title: 'Lead Qualification',
  path: 'Volume 1 - Agency/Lead Qualification.md',
  headingPath: ['Qualification Rules'],
  chunkIndex: 2,
  chunkType: 'prose',
  content: 'Qualify leads against the approved client profile.',
  authorityLevel: 'authoritative',
  securityClassification: 'internal',
  sourceVersion: 'abc123',
  documentChecksum: 'document-checksum',
  chunkChecksum: 'chunk-checksum',
  score: 1.75,
};

test('normalizes retrieval context and returns source provenance', async () => {
  let captured: KnowledgeSearchInput | undefined;
  const repository = {
    searchKnowledge: async (input: KnowledgeSearchInput) => {
      captured = input;
      return [sampleResult];
    },
  };

  const service = createKnowledgeRetrievalService(repository as never);
  const results = await service.retrieve({
    query: '  qualify leads  ',
    agent: 'Lead Agent',
    task: 'Lead Qualification',
    maximumSecurityClassification: 'internal',
    limit: 5,
  });

  assert.deepEqual(captured, {
    query: 'qualify leads',
    agent: 'lead_agent',
    task: 'lead_qualification',
    allowedSecurityClassifications: ['public', 'internal'],
    limit: 5,
  });
  assert.equal(results.length, 1);
  assert.equal(results[0]!.content, sampleResult.content);
  assert.equal(results[0]!.citation.path, sampleResult.path);
  assert.equal(results[0]!.citation.sourceVersion, sampleResult.sourceVersion);
  assert.equal(results[0]!.citation.documentChecksum, sampleResult.documentChecksum);
  assert.equal(results[0]!.citation.chunkChecksum, sampleResult.chunkChecksum);
});

test('defaults to ten results', async () => {
  let captured: KnowledgeSearchInput | undefined;
  const repository = {
    searchKnowledge: async (input: KnowledgeSearchInput) => {
      captured = input;
      return [];
    },
  };

  const service = createKnowledgeRetrievalService(repository as never);
  await service.retrieve({
    query: 'pricing policy',
    agent: 'sales_agent',
    task: 'proposal_creation',
    maximumSecurityClassification: 'restricted',
  });

  assert.equal(captured!.limit, 10);
  assert.deepEqual(captured!.allowedSecurityClassifications, ['public', 'internal', 'restricted']);
});

test('rejects empty query or execution context', async () => {
  const repository = { searchKnowledge: async () => [] };
  const service = createKnowledgeRetrievalService(repository as never);

  await assert.rejects(
    () => service.retrieve({ query: ' ', agent: 'lead_agent', task: 'qualification', maximumSecurityClassification: 'internal' }),
    /query is required/,
  );
  await assert.rejects(
    () => service.retrieve({ query: 'lead', agent: ' ', task: 'qualification', maximumSecurityClassification: 'internal' }),
    /agent is required/,
  );
  await assert.rejects(
    () => service.retrieve({ query: 'lead', agent: 'lead_agent', task: ' ', maximumSecurityClassification: 'internal' }),
    /task is required/,
  );
});

test('rejects unsafe result limits', async () => {
  const repository = { searchKnowledge: async () => [] };
  const service = createKnowledgeRetrievalService(repository as never);

  await assert.rejects(
    () => service.retrieve({ query: 'lead', agent: 'lead_agent', task: 'qualification', maximumSecurityClassification: 'internal', limit: 0 }),
    /limit must be an integer between 1 and 50/,
  );
  await assert.rejects(
    () => service.retrieve({ query: 'lead', agent: 'lead_agent', task: 'qualification', maximumSecurityClassification: 'internal', limit: 51 }),
    /limit must be an integer between 1 and 50/,
  );
});
