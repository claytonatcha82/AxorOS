import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAtlasMarkdown, parseControlledFrontmatter } from './markdown-parser.js';

test('parses controlled Atlas frontmatter and structure', () => {
  const markdown = `---
title: Production Standard
status: active
priority: 10
allowed_agents:
  - production
  - qa
tags: [react, seo]
---
# Standard

See [[Deployment SOP|deployment procedure]].

> [!warning] Mandatory
> Follow policy.

- [x] Verified

| Rule | Value |
| --- | --- |
| SEO | Required |

## Example

\`\`\`ts
export const value = 1;
\`\`\`
`;

  const parsed = parseAtlasMarkdown('Volume 2/Production Standard.md', markdown);

  assert.equal(parsed.metadata.title, 'Production Standard');
  assert.equal(parsed.metadata.status, 'active');
  assert.equal(parsed.metadata.priority, 10);
  assert.deepEqual(parsed.metadata.allowed_agents, ['production', 'qa']);
  assert.deepEqual(parsed.metadata.tags, ['react', 'seo']);
  assert.equal(parsed.headings.length, 2);
  assert.deepEqual(parsed.headings[1]?.path, ['Standard', 'Example']);
  assert.deepEqual(parsed.wikiLinks[0], { target: 'Deployment SOP', alias: 'deployment procedure', line: 3 });
  assert.equal(parsed.callouts[0]?.type, 'warning');
  assert.equal(parsed.hasChecklists, true);
  assert.equal(parsed.hasTables, true);
  assert.equal(parsed.codeFences[0]?.language, 'ts');
  assert.match(parsed.checksum, /^[a-f0-9]{64}$/);
});

test('tolerates nested frontmatter without flattening it into controlled metadata', () => {
  const raw = `title: Example
status: Active
security:
  classification: restricted
  controls:
    - audit
allowed_agents:
  - production
  - qa`;
  const parsed = parseControlledFrontmatter(raw);
  assert.equal(parsed.title, 'Example');
  assert.equal(parsed.status, 'Active');
  assert.equal(parsed.security, undefined);
  assert.deepEqual(parsed.allowed_agents, ['production', 'qa']);
});

test('rejects unclosed frontmatter and code fences', () => {
  assert.throws(() => parseAtlasMarkdown('broken.md', '---\ntitle: Broken\n'), /frontmatter is not closed/);
  assert.throws(() => parseAtlasMarkdown('broken.md', '# Title\n```ts\nconst x = 1;'), /Unclosed code fence/);
});

test('ignores structural markdown inside code fences', () => {
  const parsed = parseAtlasMarkdown('code.md', '# Real\n```md\n# Not a heading\n[[Not a link]]\n```');
  assert.equal(parsed.headings.length, 1);
  assert.equal(parsed.wikiLinks.length, 0);
});
