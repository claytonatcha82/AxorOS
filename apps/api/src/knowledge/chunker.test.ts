import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAtlasMarkdown } from './markdown-parser.js';
import { chunkAtlasDocument } from './chunker.js';

test('chunker preserves structural blocks and relationships', () => {
  const document = parseAtlasMarkdown('Volume 6/SOP.md', `# Deploy\n\nIntro paragraph.\n\n- [ ] Build\n- [ ] Test\n\n| Step | Owner |\n| --- | --- |\n| Deploy | QA |\n\n\`\`\`ts\nexport const ok = true;\n\`\`\`\n\n> [!warning] Approval\n> Human approval required.\n`);

  const chunks = chunkAtlasDocument(document);

  assert.deepEqual(chunks.map((chunk) => chunk.kind), ['prose', 'checklist', 'table', 'code', 'callout']);
  assert.deepEqual(chunks[0]?.headingPath, ['Deploy']);
  assert.equal(chunks[0]?.previousIndex, null);
  assert.equal(chunks[0]?.nextIndex, 1);
  assert.equal(chunks.at(-1)?.nextIndex, null);
  assert.ok(chunks.every((chunk) => chunk.checksum.length === 64));
});

test('chunker splits long prose at paragraph boundaries', () => {
  const paragraph = 'A'.repeat(700);
  const document = parseAtlasMarkdown('note.md', `# Long\n\n${paragraph}\n\n${paragraph}\n\n${paragraph}`);
  const chunks = chunkAtlasDocument(document, 800);
  assert.ok(chunks.length >= 2);
  assert.ok(chunks.every((chunk) => chunk.kind === 'prose'));
});
