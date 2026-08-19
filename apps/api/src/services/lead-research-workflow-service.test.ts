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
    return { status: 'succeeded', output: { query: request.input.query, results: [{ title: 'Example Business', url: 'https://example.co.za/', content: 'Official website' }] } };
  }
}

test('discovers, persists, and researches public-web evidence without enriching automatically', async () => {
  const registry = new MockRegistry();
  const persisted: unknown[] = [];
  const discoveryService = {
    async persistDiscovery(input: unknown) {
      persisted.push(input);
      return { created: [{ id: 'lead-1' }], duplicates: [] };
    },
  };
  const service = createLeadResearchWorkflowService(registry as never, discoveryService as never);
  const result = await service.research({ query: 'web designers in Durban', country: 'south africa', executionId: 'exec-1', correlationId: 'corr-1' });

  assert.equal(result.discovered, 1);
  assert.equal(result.proposals.length, 1);
  assert.equal(result.proposals[0]?.leadId, 'lead-1');
  assert.equal(result.proposals[0]?.providerPlaceId, 'place-1');
  assert.equal(persisted.length, 1);
  assert.equal(registry.calls.length, 2);
  assert.equal(registry.calls[1]?.integrationId, 'research.tavily-web');
  assert.match(String((registry.calls[1] as any).input.query), /Example Business/);
});

test('keeps the durable lead but emits no proposal when public-web research fails', async () => {
  const registry = new MockRegistry();
  registry.execute = async function(request: Record<string, any>) {
    this.calls.push(request);
    if (request.integrationId === 'research.google-places') return { status: 'succeeded', output: { query: request.input.query, candidates: [{ providerPlaceId: 'place-1', displayName: 'Example Business', types: [], source: 'google_places' }] } } as any;
    return { status: 'failed', output: { query: request.input.query, results: [], providerErrorCode: 'HTTP_503' } } as any;
  };
  const discoveryService = { async persistDiscovery() { return { created: [], duplicates: [{ providerPlaceId: 'place-1', leadId: 'lead-existing' }] }; } };
  const service = createLeadResearchWorkflowService(registry as never, discoveryService as never);
  const result = await service.research({ query: 'businesses', executionId: 'exec-1', correlationId: 'corr-1' });
  assert.equal(result.discovered, 1);
  assert.equal(result.proposals.length, 0);
});
