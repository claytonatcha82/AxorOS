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


test('requests the full allowed context window for the Ideal Client Profile exact source', async () => {
  const exactRequests: Array<Record<string, unknown>> = [];
  const exactSourceContext = {
    async assembleExact(request: Record<string, unknown>) {
      exactRequests.push(request);
      return packageFor(String(request.title));
    },
  };
  const fallbackContext = {
    async assemble() {
      throw new Error('fallback context should not be used when exact source retrieval is configured');
    },
  };

  const service = createLeadAtlasContextService(fallbackContext as never, exactSourceContext as never);
  await service.load();

  const idealRequest = exactRequests.find((request) => request.title === 'Ideal Client Profile');
  assert.ok(idealRequest);
  assert.equal(idealRequest.maxCharacters, 40_000);
  assert.equal(idealRequest.pathPrefix, 'Volume 1 - Agency/02 - Agency Positioning/Ideal Client Profile');
  assert.equal(
    exactRequests.find((request) => request.title === 'Lead Generation System')?.pathPrefix,
    'Volume 1 - Agency/05 - Client Acquisition/Lead Generation System',
  );
  assert.equal(
    exactRequests.find((request) => request.title === 'Lead Qualification')?.pathPrefix,
    'Volume 1 - Agency/05 - Client Acquisition/Lead Qualification',
  );
  assert.equal(
    exactRequests.find((request) => request.title === 'Lead Agent')?.pathPrefix,
    'Volume 1 - Agency/11 - AI Agency Infrastructure/Lead Agent',
  );
  assert.ok(exactRequests.filter((request) => request.title !== 'Ideal Client Profile').every((request) => request.maxCharacters === 14_000));
});
