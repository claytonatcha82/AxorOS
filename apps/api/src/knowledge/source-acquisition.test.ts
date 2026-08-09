import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { detectAtlasChanges, discoverAtlasMarkdown } from './source-acquisition.js';

test('discovers markdown deterministically and ignores Obsidian internals', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'axoros-atlas-'));
  try {
    await mkdir(path.join(root, '.obsidian'));
    await mkdir(path.join(root, 'Volume 1'));
    await writeFile(path.join(root, '.obsidian', 'workspace.json'), '{}');
    await writeFile(path.join(root, 'Volume 1', 'B.md'), '# B');
    await writeFile(path.join(root, 'A.md'), '# A');
    await writeFile(path.join(root, 'ignore.txt'), 'ignore');

    const files = await discoverAtlasMarkdown(root);
    assert.deepEqual(files.map((item) => item.relativePath), ['A.md', 'Volume 1/B.md']);
    assert.equal(files.every((item) => /^[a-f0-9]{64}$/.test(item.checksum)), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('classifies added, changed, unchanged, and missing source files', () => {
  const source = [
    { absolutePath: 'a', relativePath: 'A.md', checksum: 'same', lastModified: new Date(0).toISOString(), sizeBytes: 1 },
    { absolutePath: 'b', relativePath: 'B.md', checksum: 'new', lastModified: new Date(0).toISOString(), sizeBytes: 1 },
    { absolutePath: 'c', relativePath: 'C.md', checksum: 'added', lastModified: new Date(0).toISOString(), sizeBytes: 1 },
  ];
  const existing = [
    { documentId: 'a', path: 'A.md', checksum: 'same', sourceVersion: '1', status: 'active' as const },
    { documentId: 'b', path: 'B.md', checksum: 'old', sourceVersion: '1', status: 'active' as const },
    { documentId: 'd', path: 'D.md', checksum: 'gone', sourceVersion: '1', status: 'active' as const },
  ];

  const result = detectAtlasChanges(source, existing);
  assert.deepEqual(result.unchanged.map((item) => item.relativePath), ['A.md']);
  assert.deepEqual(result.changed.map((item) => item.relativePath), ['B.md']);
  assert.deepEqual(result.added.map((item) => item.relativePath), ['C.md']);
  assert.deepEqual(result.missingFromSource.map((item) => item.path), ['D.md']);
});
