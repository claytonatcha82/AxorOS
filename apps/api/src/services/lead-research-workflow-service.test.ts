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
      return { id: String(input.leadId) };
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
  assert.equal(result.enriched[0]?.leadId, 'lead-1');
  assert.equal(result.enriched[0]?.companyName, 'Example Business');
  assert.equal(result.enriched[0]?.officialWebsiteUrl, 'https://examplebusiness.co.za/');
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
      { title: 'Example Business', url: 'https://examplebusiness.co.za/', content: 'Candidate one.' },
      { title: 'Example Business', url: 'https://examplebusiness.com/', content: 'Candidate two.' },
    ] } } as any;
  };
  const enrichments: unknown[] = [];
  const service = createLeadResearchWorkflowService(registry as never, discoveryService() as never, enrichmentService(enrichments) as never);
  const result = await service.research({ query: 'businesses', executionId: 'exec-1', correlationId: 'corr-1' });
  assert.equal(result.enriched.length, 0);
  assert.equal(result.proposals.length, 1);
  assert.equal(result.proposals[0]?.selectionStatus, 'ambiguous');
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

  assert.equal(result.discovered, 1);
  assert.equal(result.enriched.length, 0);
  assert.equal(result.proposals.length, 0);
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
  assert.equal(enrichments.length, 1);
  assert.equal(registry.calls.length, 2);
  assert.equal(registry.calls[1]?.integrationId, 'research.tavily-web');
});
