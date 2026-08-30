import assert from 'node:assert/strict';
import test from 'node:test';
import { createKnowledgeRepository } from './knowledge-repository.js';

test('reconciles a changed Atlas document_id on the same canonical source path', async () => {
  const calls: Array<{ text: string; values?: unknown[] }> = [];
  const client = {
    on() {},
    removeListener() {},
    release() {},
    async query(text: string, values?: unknown[]) {
      calls.push({ text, values });
      if (text === 'begin' || text === 'commit' || text === 'rollback') return { rows: [] };
      if (text.includes('where path = $1')) {
        return { rows: [{ id: 'db-doc-1', document_id: 'old-document-id' }] };
      }
      if (text.includes('where document_id = $1') && text.includes('id <> $2')) {
        return { rows: [] };
      }
      if (text.includes('update knowledge.documents') && text.includes('set document_id = $2')) {
        return { rows: [] };
      }
      if (text.includes('insert into knowledge.documents')) {
        return { rows: [{ id: 'db-doc-1' }] };
      }
      if (text.includes('delete from knowledge.chunks')) return { rows: [] };
      return { rows: [] };
    },
  };

  const pool = {
    async connect() { return client; },
  } as any;

  const repository = createKnowledgeRepository(pool);
  const databaseId = await repository.replaceDocumentWithChunks('run-1', {
    documentId: 'new-document-id',
    title: 'Canonical Atlas Document',
    path: 'Volume X/File.md',
    documentType: 'reference',
    knowledgeDomain: 'general',
    status: 'active',
    priority: 50,
    authorityLevel: 'reference',
    allowedAgents: [],
    applicableTasks: [],
    serviceTypes: [],
    technology: [],
    projectStage: [],
    securityClassification: 'internal',
    retrievalWeight: 1,
    sourceVersion: 'new-source-commit',
    checksum: 'checksum-new',
    lastModified: '2026-08-30T00:00:00.000Z',
  }, []);

  assert.equal(databaseId, 'db-doc-1');

  const identityUpdate = calls.find((call) =>
    call.text.includes('update knowledge.documents') &&
    call.text.includes('set document_id = $2'),
  );
  assert.ok(identityUpdate, 'expected the existing canonical path row to adopt the new document_id');
  assert.deepEqual(identityUpdate.values, ['db-doc-1', 'new-document-id']);

  const insert = calls.find((call) => call.text.includes('insert into knowledge.documents'));
  assert.ok(insert, 'expected normal document upsert to continue after identity reconciliation');

  const deleteChunks = calls.find((call) => call.text.includes('delete from knowledge.chunks'));
  assert.deepEqual(deleteChunks?.values, ['db-doc-1']);
});

test('fails closed when a replacement document_id already belongs to another path', async () => {
  const client = {
    on() {},
    removeListener() {},
    release() {},
    async query(text: string) {
      if (text === 'begin' || text === 'rollback') return { rows: [] };
      if (text.includes('where path = $1')) {
        return { rows: [{ id: 'db-doc-1', document_id: 'old-document-id' }] };
      }
      if (text.includes('where document_id = $1') && text.includes('id <> $2')) {
        return { rows: [{ id: 'db-doc-2', path: 'Volume Y/Other.md' }] };
      }
      return { rows: [] };
    },
  };

  const pool = { async connect() { return client; } } as any;
  const repository = createKnowledgeRepository(pool);

  await assert.rejects(
    () => repository.replaceDocumentWithChunks('run-1', {
      documentId: 'new-document-id',
      title: 'Conflicting Atlas Document',
      path: 'Volume X/File.md',
      documentType: 'reference',
      knowledgeDomain: 'general',
      status: 'active',
      priority: 50,
      authorityLevel: 'reference',
      allowedAgents: [],
      applicableTasks: [],
      serviceTypes: [],
      technology: [],
      projectStage: [],
      securityClassification: 'internal',
      retrievalWeight: 1,
      sourceVersion: 'new-source-commit',
      checksum: 'checksum-new',
      lastModified: '2026-08-30T00:00:00.000Z',
    }, []),
    /Knowledge document identity conflict/,
  );
});
