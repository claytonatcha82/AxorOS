import assert from 'node:assert/strict';
import test from 'node:test';
import { createLeadAtlasContextService } from './lead-atlas-context-service.js';

function packageFor(title: string) {
  return {
    query: title,
    context: `${title} context`,
    sources: [{
      reference: '[ATLAS-01]',
      score: 1,
      citation: {
        documentId: `doc-${title}`,
        documentKey: title.toLowerCase().replace(/\s+/g, '-'),
        title,
        path: `Volume 1 - Agency/example/${title}.md.md`,
        headingPath: [],
        chunkId: `chunk-${title}`,
        chunkIndex: 0,
        chunkType: 'section',
        authorityLevel: 'governing',
        securityClassification: 'internal',
        sourceVersion: '2.0',
        documentChecksum: 'document-checksum',
        chunkChecksum: 'chunk-checksum',
      },
    }],
    includedItems: 1,
    truncated: false,
    characterCount: title.length,
  } as const;
}

test('loads all required Lead Agent knowledge from Atlas OS', async () => {
  const titles = ['Ideal Client Profile', 'Lead Generation System', 'Lead Qualification', 'Lead Agent'];
  let index = 0;
  const contextService = {
    async assemble(request: Record<string, unknown>) {
      assert.equal(request.agent, 'lead_agent');
      assert.equal(request.task, 'lead_research_and_qualification');
      return packageFor(titles[index++]!);
    },
  };

  const service = createLeadAtlasContextService(contextService as never);
  const bundle = await service.load();
  assert.equal(bundle.idealClientProfile.sources[0]?.citation.title, 'Ideal Client Profile');
  assert.equal(bundle.leadGeneration.sources[0]?.citation.title, 'Lead Generation System');
  assert.equal(bundle.leadQualification.sources[0]?.citation.title, 'Lead Qualification');
  assert.equal(bundle.leadAgentGovernance.sources[0]?.citation.title, 'Lead Agent');
});

test('fails closed when a required Atlas source is not retrieved', async () => {
  const contextService = {
    async assemble() {
      return packageFor('Unrelated Document');
    },
  };
  const service = createLeadAtlasContextService(contextService as never);
  await assert.rejects(() => service.load(), /Required Atlas OS source was not retrieved/);
});
