import assert from 'node:assert/strict';
import test from 'node:test';
import { createKnowledgeIngestionService } from './knowledge-ingestion-service.js';

test('ingests a release and records success counts', async () => {
  const calls: string[] = [];
  const repository = {
    createIngestionRun: async () => { calls.push('create'); return 'run-1'; },
    replaceDocumentWithChunks: async (_runId: string, document: { title: string }, chunks: unknown[]) => {
      calls.push(`replace:${document.title}:${chunks.length}`);
      return 'doc-1';
    },
    completeIngestionRun: async (_id: string, documents: number, chunks: number) => { calls.push(`complete:${documents}:${chunks}`); },
    failIngestionRun: async () => { calls.push('fail'); },
  } as never;

  const service = createKnowledgeIngestionService(repository);
  const result = await service.ingestRelease({
    sourceCommit: 'abc123',
    knowledgeRelease: '2026-08-09',
    indexVersion: 'staging-1',
    chunkingVersion: 'v1',
    metadataSchemaVersion: 'v1',
    documents: [{
      path: 'Volume 2/Example.md',
      lastModified: '2026-08-09T20:00:00.000Z',
      markdown: '---\ntitle: Example\nknowledge_domain: development\ndocument_type: standard\n---\n# Example\n\nUseful guidance.',
    }],
  });

  assert.equal(result.runId, 'run-1');
  assert.equal(result.documentCount, 1);
  assert.ok(result.chunkCount >= 1);
  assert.equal(calls[0], 'create');
  assert.match(calls[1]!, /^replace:Example:/);
  assert.match(calls[2]!, /^complete:1:/);
  assert.equal(calls.includes('fail'), false);
});

test('marks ingestion run failed when document validation fails', async () => {
  const calls: string[] = [];
  const repository = {
    createIngestionRun: async () => 'run-2',
    replaceDocumentWithChunks: async () => 'doc-1',
    completeIngestionRun: async () => undefined,
    failIngestionRun: async (_id: string, message: string) => { calls.push(message); },
  } as never;

  const service = createKnowledgeIngestionService(repository);
  await assert.rejects(
    () => service.ingestRelease({
      sourceCommit: 'abc123',
      knowledgeRelease: '2026-08-09',
      indexVersion: 'staging-1',
      chunkingVersion: 'v1',
      metadataSchemaVersion: 'v1',
      documents: [{
        path: 'Bad.md',
        lastModified: '2026-08-09T20:00:00.000Z',
        markdown: '---\nstatus: invented\n---\n# Bad',
      }],
    }),
    /Invalid knowledge status/,
  );
  assert.equal(calls.length, 1);
  assert.match(calls[0]!, /Invalid knowledge status/);
});
