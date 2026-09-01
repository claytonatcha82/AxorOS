import assert from 'node:assert/strict';
import test from 'node:test';
import { createExactSourceContextService } from './exact-source-context-service.js';

test('exact-source retrieval selects one deterministic active document before loading chunks', async () => {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const pool = {
    async query(text: string, values: unknown[]) {
      calls.push({ text, values });
      return {
        rows: [
          {
            chunk_id: 'chunk-1',
            document_id: 'db-doc-1',
            document_key: 'atlas-doc-1',
            title: 'Ideal Client Profile',
            path: 'Volume 1 - Agency/02 - Agency Positioning/Ideal Client Profile.md',
            heading_path: ['Target Industries'],
            chunk_index: 0,
            chunk_type: 'section',
            content: '- Construction\n- Engineering',
            authority_level: 'authoritative',
            security_classification: 'internal',
            source_version: 'v1',
            document_checksum: 'doc-checksum',
            chunk_checksum: 'chunk-checksum',
          },
        ],
      };
    },
  };

  const service = createExactSourceContextService(pool as never);
  const result = await service.assembleExact({
    title: 'Ideal Client Profile',
    pathPrefix: 'Volume 1 - Agency/',
    agent: 'lead_agent',
    task: 'lead_research_and_qualification',
    maximumSecurityClassification: 'internal',
    maxCharacters: 40_000,
  });

  assert.equal(calls.length, 1);
  assert.match(calls[0]!.text, /with selected_document as/i);
  assert.match(calls[0]!.text, /limit 1/i);
  assert.match(calls[0]!.text, /order by[\s\S]*authority_level[\s\S]*priority desc[\s\S]*last_modified desc[\s\S]*path asc/i);
  assert.match(calls[0]!.text, /join knowledge\.chunks c on c\.document_id = d\.id/i);
  assert.equal(result.sources.length, 1);
  assert.deepEqual(result.sources[0]?.citation.headingPath, ['Target Industries']);
  assert.match(result.context, /Construction/);
});
