import assert from 'node:assert/strict';
import test from 'node:test';
import { createLeadResearchWorkflowService } from './lead-research-workflow-service.js';

class MockRegistry {
  calls: Array<Record<string, unknown>> = [];
  async execute(request: Record<string, any>) {
    this.calls.push(request);
    if (request.integrationId === 'research.google-places') {
      return { status: 'succeeded', output: { query: request.input.query, candidates: [{ providerPlaceId: 'place-1', displayName: 'Example Business', formattedAddress: 'Durban, South Africa', types: [], source: 'google_places' }] } };
    }
    return { status: 'succeeded', output: { query: request.input.query, results: [{ title: 'Example Business | Home', url: 'https://examplebusiness.co.za/', content: 'Official website' }] } };
  }
}

function discoveryService() {
  return { async persistDiscovery() { return { created: [{ id: 'lead-1' }], duplicates: [] }; } };
}

function enrichmentService(calls: unknown[]) {
  return {
    async enrich(input: Record<string, unknown>) {
      calls.push(input);
      return { id: String(input.leadId), companyName: String(input.companyName) };
    },
  };
}

test('discovers, researches, verifies, and enriches a strongly supported business', async () => {
  const registry = new MockRegistry();
  const enrichments: unknown[] = [];
  const service = createLeadResearchWorkflowService(registry as never, discoveryService() as never, enrichmentService(enrichments) as never);
  const result = await service.research({ query: 'engineering businesses in Durban', country: 'south africa', executionId: 'exec-1', correlationId: 'corr-1' });

  assert.equal(result.discovered, 1);
  assert.equal(result.enriched.length, 1);
  assert.equal(result.proposals.length, 0);
  assert.deepEqual(result.outcomes, { enriched: 1, duplicateSkipped: 0, webResearchFailed: 0, unresolved: 0, ambiguous: 0, notFound: 0 });
  assert.equal(result.enriched[0]?.leadId, 'lead-1');
  assert.equal(result.enriched[0]?.companyName, 'Example Business');
  assert.equal(result.enriched[0]?.officialWebsiteUrl, 'https://examplebusiness.co.za/');
  assert.equal(result.enriched[0]?.websiteVerificationStatus, 'verified');
  assert.equal(enrichments.length, 1);
  assert.equal((enrichments[0] as any).companyName, 'Example Business');
  assert.equal(registry.calls.length, 2);
  assert.equal(registry.calls[1]?.integrationId, 'research.tavily-web');
});

test('keeps ambiguous website identity as an unresolved proposal and does not enrich', async () => {
  const registry = new MockRegistry();
  registry.execute = async function(request: Record<string, any>) {
    this.calls.push(request);
    if (request.integrationId === 'research.google-places') return { status: 'succeeded', output: { query: request.input.query, candidates: [{ providerPlaceId: 'place-1', displayName: 'Example Business', types: [], source: 'google_places' }] } } as any;
    return { status: 'succeeded', output: { query: request.input.query, results: [
      { title: 'Example Business', url: 'https://examplebusiness.co.za/', content: 'Example Business candidate.' },
      { title: 'Example Business', url: 'https://examplebusiness.com/', content: 'Example Business candidate.' },
    ] } } as any;
  };
  const enrichments: unknown[] = [];
  const service = createLeadResearchWorkflowService(registry as never, discoveryService() as never, enrichmentService(enrichments) as never);
  const result = await service.research({ query: 'businesses', executionId: 'exec-1', correlationId: 'corr-1' });
  assert.equal(result.enriched.length, 0);
  assert.equal(result.proposals.length, 1);
  assert.equal(result.proposals[0]?.selectionStatus, 'ambiguous');
  assert.deepEqual(result.outcomes, { enriched: 0, duplicateSkipped: 0, webResearchFailed: 0, unresolved: 1, ambiguous: 1, notFound: 0 });
  assert.equal(enrichments.length, 0);
});

test('keeps the durable discovery but does not enrich when public-web research fails', async () => {
  const registry = new MockRegistry();
  registry.execute = async function(request: Record<string, any>) {
    this.calls.push(request);
    if (request.integrationId === 'research.google-places') return { status: 'succeeded', output: { query: request.input.query, candidates: [{ providerPlaceId: 'place-1', displayName: 'Example Business', types: [], source: 'google_places' }] } } as any;
    return { status: 'failed', output: { query: request.input.query, results: [], providerErrorCode: 'HTTP_503' } } as any;
  };
  const enrichments: unknown[] = [];
  const service = createLeadResearchWorkflowService(registry as never, discoveryService() as never, enrichmentService(enrichments) as never);
  const result = await service.research({ query: 'businesses', executionId: 'exec-1', correlationId: 'corr-1' });
  assert.equal(result.discovered, 1);
  assert.equal(result.enriched.length, 0);
  assert.equal(result.proposals.length, 0);
  assert.deepEqual(result.outcomes, { enriched: 0, duplicateSkipped: 0, webResearchFailed: 1, unresolved: 0, ambiguous: 0, notFound: 0 });
  assert.equal(enrichments.length, 0);
});

test('skips public-web enrichment for a duplicate lead that has already moved beyond discovery', async () => {
  const registry = new MockRegistry();
  const enrichments: unknown[] = [];
  const duplicateDiscovery = {
    async persistDiscovery() {
      return {
        created: [],
        duplicates: [{ providerPlaceId: 'place-1', leadId: 'lead-existing', enrichmentPending: false }],
      };
    },
  };
  const service = createLeadResearchWorkflowService(registry as never, duplicateDiscovery as never, enrichmentService(enrichments) as never);
  const result = await service.research({ query: 'engineering businesses in Durban', country: 'south africa', executionId: 'exec-duplicate', correlationId: 'corr-duplicate' });

  assert.equal(result.discovered, 0);
  assert.equal(result.enriched.length, 0);
  assert.equal(result.proposals.length, 0);
  assert.deepEqual(result.outcomes, { enriched: 0, duplicateSkipped: 1, webResearchFailed: 0, unresolved: 0, ambiguous: 0, notFound: 0 });
  assert.equal(enrichments.length, 0);
  assert.equal(registry.calls.length, 1);
  assert.equal(registry.calls[0]?.integrationId, 'research.google-places');
});

test('retries public-web enrichment for a duplicate that is still discovery-only', async () => {
  const registry = new MockRegistry();
  const enrichments: unknown[] = [];
  const duplicateDiscovery = {
    async persistDiscovery() {
      return {
        created: [],
        duplicates: [{ providerPlaceId: 'place-1', leadId: 'lead-existing', enrichmentPending: true }],
      };
    },
  };
  const service = createLeadResearchWorkflowService(registry as never, duplicateDiscovery as never, enrichmentService(enrichments) as never);
  const result = await service.research({ query: 'engineering businesses in Durban', country: 'south africa', executionId: 'exec-retry', correlationId: 'corr-retry' });

  assert.equal(result.discovered, 1);
  assert.equal(result.enriched.length, 1);
  assert.equal(result.enriched[0]?.leadId, 'lead-existing');
  assert.deepEqual(result.outcomes, { enriched: 1, duplicateSkipped: 0, webResearchFailed: 0, unresolved: 0, ambiguous: 0, notFound: 0 });
  assert.equal(enrichments.length, 1);
  assert.equal(registry.calls.length, 2);
  assert.equal(registry.calls[1]?.integrationId, 'research.tavily-web');
});

test('overscans one Google Places response so processed duplicates do not consume actionable prospect slots', async () => {
  const registry = new MockRegistry();
  registry.execute = async function(request: Record<string, any>) {
    this.calls.push(request);
    if (request.integrationId === 'research.google-places') {
      return {
        status: 'succeeded',
        output: {
          query: request.input.query,
          candidates: [
            { providerPlaceId: 'dup-1', displayName: 'Duplicate One', types: [], source: 'google_places' },
            { providerPlaceId: 'dup-2', displayName: 'Duplicate Two', types: [], source: 'google_places' },
            { providerPlaceId: 'dup-3', displayName: 'Duplicate Three', types: [], source: 'google_places' },
            { providerPlaceId: 'new-1', displayName: 'New One', types: [], source: 'google_places' },
            { providerPlaceId: 'new-2', displayName: 'New Two', types: [], source: 'google_places' },
            { providerPlaceId: 'unused-1', displayName: 'Unused One', types: [], source: 'google_places' },
          ],
        },
      } as any;
    }
    const businessName = String(request.input.query).split(' official website')[0] ?? 'Business';
    return {
      status: 'succeeded',
      output: {
        query: request.input.query,
        results: [{ title: businessName, url: `https://${businessName.toLowerCase().replaceAll(' ', '')}.co.za/`, content: 'Official website' }],
      },
    } as any;
  };

  const persistedIds: string[] = [];
  const overscanDiscovery = {
    async persistDiscovery(input: any) {
      const providerPlaceId = input.discovery.candidates[0].providerPlaceId as string;
      persistedIds.push(providerPlaceId);
      if (providerPlaceId.startsWith('dup-')) {
        return { created: [], duplicates: [{ providerPlaceId, leadId: `lead-${providerPlaceId}`, enrichmentPending: false }] };
      }
      return { created: [{ id: `lead-${providerPlaceId}` }], duplicates: [] };
    },
  };
  const enrichments: unknown[] = [];
  const service = createLeadResearchWorkflowService(registry as never, overscanDiscovery as never, enrichmentService(enrichments) as never);
  const result = await service.research({
    query: 'construction businesses',
    maxBusinesses: 2,
    maxWebResultsPerBusiness: 3,
    executionId: 'exec-overscan',
    correlationId: 'corr-overscan',
  });

  assert.equal((registry.calls[0] as any).input.maxResults, 6);
  assert.deepEqual(persistedIds, ['dup-1', 'dup-2', 'dup-3', 'new-1', 'new-2']);
  assert.equal(result.discovered, 2);
  assert.equal(result.enriched.length, 2);
  assert.deepEqual(result.outcomes, { enriched: 2, duplicateSkipped: 3, webResearchFailed: 0, unresolved: 0, ambiguous: 0, notFound: 0 });
  assert.equal(registry.calls.filter((call) => call.integrationId === 'research.tavily-web').length, 2);
  assert.equal(enrichments.length, 2);
});

test('retains a business as a website opportunity when no official website is found', async () => {
  const registry = new MockRegistry();
  registry.execute = async function(request: Record<string, any>) {
    this.calls.push(request);
    if (request.integrationId === 'research.google-places') {
      return { status: 'succeeded', output: { query: request.input.query, candidates: [{ providerPlaceId: 'place-not-found', displayName: 'Example Business', formattedAddress: 'Durban, South Africa', types: [], source: 'google_places' }] } } as any;
    }
    return { status: 'succeeded', output: { query: request.input.query, results: [
      { title: 'Example Business on Facebook', url: 'https://facebook.com/examplebusiness', content: 'Social profile.' },
      { title: 'Example Business on LinkedIn', url: 'https://linkedin.com/company/examplebusiness', content: 'Company profile.' },
    ] } } as any;
  };
  const enrichments: unknown[] = [];
  const service = createLeadResearchWorkflowService(registry as never, discoveryService() as never, enrichmentService(enrichments) as never);
  const result = await service.research({ query: 'businesses', executionId: 'exec-not-found', correlationId: 'corr-not-found' });

  assert.equal(result.enriched.length, 1);
  assert.equal(result.proposals.length, 0);
  assert.equal(result.enriched[0]?.leadId, 'lead-1');
  assert.equal(result.enriched[0]?.companyName, 'Example Business');
  assert.equal(result.enriched[0]?.officialWebsiteUrl, null);
  assert.equal(result.enriched[0]?.websiteVerificationStatus, 'not_found');
  assert.deepEqual(result.outcomes, { enriched: 1, duplicateSkipped: 0, webResearchFailed: 0, unresolved: 0, ambiguous: 0, notFound: 1 });
  assert.equal((enrichments[0] as any).officialWebsiteUrl, null);
  assert.equal((enrichments[0] as any).companyName, 'Example Business');
});
