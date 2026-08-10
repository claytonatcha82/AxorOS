import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createIncrementalIngestionRunner } from './incremental-ingestion-runner.js';

test('incremental runner skips unchanged documents', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'axoros-atlas-'));
  const filePath = path.join(root, 'sample.md');
  await writeFile(filePath, '# Sample\n\nHello', 'utf8');

  const calls: string[] = [];
  const repository = {
    async listDocumentFingerprints() {
      const { createHash } = await import('node:crypto');
      const checksum = createHash('sha256').update('# Sample\n\nHello').digest('hex');
      return [{ path: 'sample.md', checksum }];
    },
    async createIngestionRun() { calls.push('createIngestionRun'); return 'run-1'; },
    async completeIngestionRun() {},
    async failIngestionRun() {},
    async replaceDocumentWithChunks() { return 'doc-1'; },
  } as any;

  const runner = createIncrementalIngestionRunner(repository);
  const result = await runner.run({
    atlasRoot: root,
    sourceCommit: 'abc123',
    knowledgeRelease: 'test',
    indexVersion: 'v1',
    chunkingVersion: 'v1',
    metadataSchemaVersion: 'v1',
  });

  assert.equal(result.unchanged, 1);
  assert.equal(result.ingestedDocuments, 0);
  assert.deepEqual(calls, []);
});
