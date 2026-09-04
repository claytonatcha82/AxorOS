import assert from 'node:assert/strict';
import test from 'node:test';
import type { PublicWebSearchResult } from '../integrations/public-web-research-integration.js';
import { createLeadGapResearchService } from './lead-gap-research-service.js';

class MockRegistry {
  calls: Array<{ input: Record<string, unknown>; executionId: string }> = [];
  results: PublicWebSearchResult[][] = [];
  callIndex = 0;

  async execute(request: Record<string, any>): Promise<any> {
    const result = this.results[this.callIndex] ?? [];
    this.callIndex++;
    this.calls.push({ input: request.input, executionId: request.executionId });
    return { status: 'succeeded', output: { query: request.input.query, results: result } };
  }

  reset(results: PublicWebSearchResult[][]) {
    this.calls = [];
    this.results = results;
    this.callIndex = 0;
  }
}

function result(title: string, content: string, url: string): PublicWebSearchResult {
  return { title, content, url };
}

test('performs targeted searches for missing businessFit evidence', async () => {
  const registry = new MockRegistry();
  const service = createLeadGapResearchService(registry as never);
  registry.reset([[result('About Acme', 'Acme Construction was established in 2010 and employs 120 staff.', 'https://about.example/acme')]]);

  const output = await service.researchGaps({
    companyName: 'Acme Construction',
    officialWebsiteUrl: null,
    missingCategories: ['businessFit'],
    existingEvidence: [],
    executionId: 'exec-1',
    correlationId: 'corr-1',
  });

  assert.equal(output.searchesPerformed, 1);
  assert.deepEqual(output.categoriesResearched, ['businessFit']);
  assert.equal(output.additionalResults.length, 1);
  assert.ok(String(registry.calls[0]!.input.query).includes('employees'));
});

test('uses includeDomains for first-party website research when officialWebsiteUrl is known', async () => {
  const registry = new MockRegistry();
  const service = createLeadGapResearchService(registry as never);
  registry.reset([[result('Our Team', 'John Smith, Managing Director. Contact us.', 'https://acme.example/team')]]);

  await service.researchGaps({
    companyName: 'Acme Construction',
    officialWebsiteUrl: 'https://acme.example/',
    missingCategories: ['decisionMakerAccess'],
    existingEvidence: [],
    executionId: 'exec-2',
    correlationId: 'corr-2',
  });

  assert.equal(registry.calls.length, 3);
  const firstPartyCall = registry.calls.find((call) => (call.input.includeDomains as string[] | undefined)?.includes('acme.example'));
  assert.ok(firstPartyCall);
});

test('does not return evidence already present in the initial evidence set', async () => {
  const registry = new MockRegistry();
  const service = createLeadGapResearchService(registry as never);
  registry.reset([[result('Duplicate', 'Same content.', 'https://existing.example/')]]);

  const output = await service.researchGaps({
    companyName: 'Acme Construction',
    officialWebsiteUrl: null,
    missingCategories: ['businessFit'],
    existingEvidence: [result('Existing', 'Existing content.', 'https://existing.example/')],
    executionId: 'exec-3',
    correlationId: 'corr-3',
  });

  assert.equal(output.additionalResults.length, 0);
});

test('caps total additional searches at six', async () => {
  const registry = new MockRegistry();
  const service = createLeadGapResearchService(registry as never);
  registry.reset(Array.from({ length: 10 }, (_, index) => [result(`Result ${index}`, `Content ${index}.`, `https://result-${index}.example/`)]));

  const output = await service.researchGaps({
    companyName: 'Acme Construction',
    officialWebsiteUrl: 'https://acme.example/',
    missingCategories: ['businessFit', 'projectFit', 'partnershipPotential', 'decisionMakerAccess', 'commercialFit', 'timeline'],
    existingEvidence: [],
    executionId: 'exec-4',
    correlationId: 'corr-4',
  });

  assert.equal(output.searchesPerformed, 6);
});
