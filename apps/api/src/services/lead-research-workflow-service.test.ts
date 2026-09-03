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
  return { async persistDiscovery() { return { created: [{ id: 'lead-1' }], duplicates: [], skipped: [] }; } };
}

function discoveryServiceWithSkipped() {
  return {
    async persistDiscovery(input: { discovery: { candidates: Array<{ providerPlaceId: string; displayName: string }> } }) {
      const skipped: Array<{ providerPlaceId: string; reason: string }> = [];
      const created: Array<{ id: string }> = [];
      for (const c of input.discovery.candidates) {
        if (c.displayName.startsWith('Google Place ')) skipped.push({ providerPlaceId: c.providerPlaceId, reason: 'provider ID fallback' });
        else created.push({ id: `lead-${c.providerPlaceId}` });
      }
      return { created, duplicates: [], skipped };
    },
  };
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
  assert.deepEqual(result.outcomes, { enriched: 1, duplicateSkipped: 0, webResearchFailed: 0, unresolved: 0, ambiguous: 0, notFound: 0, skipped: 0 });
  assert.equal(result.enriched[0]?.leadId, 'lead-1');
  assert.equal(result.enriched[0]?.companyName, 'Example Business');
  assert.equal(result.enriched[0]?.officialWebsiteUrl, 'https://examplebusiness.co.za/');
  assert.equal(result.enriched[0]?.websiteVerificationStatus, 'verified');
  assert.equal(enrichments.length, 1);
  assert.equal((enrichments[0] as any).companyName, 'Example Business');
  assert.equal(registry.calls.length, 2);
  assert.match(String((registry.calls[1]?.input as any).query), /contact details projects tenders growth/);
});

test('retains a business as a website opportunity when no official website is found', async () => {
  const registry = new MockRegistry();
  registry.execute = async function(request: Record<string, any>): Promise<any> {
    this.calls.push(request);
    if (request.integrationId === 'research.google-places') {
      return { status: 'succeeded', output: { query: request.input.query, candidates: [{ providerPlaceId: 'place-not-found', displayName: 'Example Business', formattedAddress: 'Durban, South Africa', types: [], source: 'google_places' }] } };
    }
    return { status: 'succeeded', output: { query: request.input.query, results: [
      { title: 'Example Business on Facebook', url: 'https://facebook.com/examplebusiness', content: 'Social profile.' },
      { title: 'Example Business on LinkedIn', url: 'https://linkedin.com/company/examplebusiness', content: 'Company profile.' },
    ] } };
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
  assert.deepEqual(result.outcomes, { enriched: 1, duplicateSkipped: 0, webResearchFailed: 0, unresolved: 0, ambiguous: 0, notFound: 1, skipped: 0 });
  assert.equal((enrichments[0] as any).officialWebsiteUrl, null);
  assert.equal((enrichments[0] as any).companyName, 'Example Business');
});

test('skips provider-ID fallback candidates without enriching them', async () => {
  const registry = new MockRegistry();
  const enrichments: unknown[] = [];
  const service = createLeadResearchWorkflowService(registry as never, discoveryServiceWithSkipped() as never, enrichmentService(enrichments) as never);
  const result = await service.research({ query: 'construction businesses', executionId: 'exec-skip', correlationId: 'corr-skip' });
  assert.equal(result.discovered, 0);
  assert.equal(result.enriched.length, 0);
  assert.equal(result.outcomes.skipped, 1);
  assert.equal(result.outcomes.duplicateSkipped, 0);
  assert.equal(enrichments.length, 0);
});

test('passes pageToken through to the Google Places integration', async () => {
  const registry = new MockRegistry();
  const service = createLeadResearchWorkflowService(registry as never, discoveryService() as never, enrichmentService([]) as never);
  await service.research({ query: 'construction businesses', executionId: 'exec-page-token', correlationId: 'corr-page-token', pageToken: 'token_abc' });
  assert.equal(registry.calls[0]?.integrationId, 'research.google-places');
  assert.equal((registry.calls[0]?.input as any).pageToken, 'token_abc');
});

test('returns nextPageToken when Google Places provides one', async () => {
  const registry = new MockRegistry();
  const originalExecute = registry.execute.bind(registry);
  registry.execute = async function(request: Record<string, any>): Promise<any> {
    const result = await originalExecute(request);
    if (request.integrationId === 'research.google-places') return { ...result, output: { ...result.output, nextPageToken: 'token_xyz' } };
    return result;
  };
  const service = createLeadResearchWorkflowService(registry as never, discoveryService() as never, enrichmentService([]) as never);
  const result = await service.research({ query: 'construction businesses', executionId: 'exec-next-token', correlationId: 'corr-next-token' });
  assert.equal(result.nextPageToken, 'token_xyz');
});

test('returns undefined nextPageToken when Google Places provides none', async () => {
  const registry = new MockRegistry();
  const service = createLeadResearchWorkflowService(registry as never, discoveryService() as never, enrichmentService([]) as never);
  const result = await service.research({ query: 'construction businesses', executionId: 'exec-no-next-token', correlationId: 'corr-no-next-token' });
  assert.equal(result.nextPageToken, undefined);
});

test('web query includes agency-opportunity keywords', async () => {
  const registry = new MockRegistry();
  const service = createLeadResearchWorkflowService(registry as never, discoveryService() as never, enrichmentService([]) as never);
  await service.research({ query: 'construction businesses', executionId: 'exec-query', correlationId: 'corr-query' });
  const webQuery = String((registry.calls[1]?.input as any)?.query ?? '');
  assert.ok(webQuery.includes('official website'), 'query should include official website');
  assert.ok(webQuery.includes('contact details'), 'query should include contact details');
  assert.ok(webQuery.includes('projects'), 'query should include projects');
  assert.ok(webQuery.includes('tenders'), 'query should include tenders');
});
