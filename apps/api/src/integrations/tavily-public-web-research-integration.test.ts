import assert from 'node:assert/strict';
import test from 'node:test';
import { createTavilyPublicWebResearchIntegration } from './tavily-public-web-research-integration.js';

function request(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    integrationId: 'research.tavily-web',
    operation: 'search_public_web',
    requestedBy: 'lead_agent' as const,
    executionId: 'exec-1',
    correlationId: 'corr-1',
    mode: 'live' as const,
    risk: 'low' as const,
    input: { query: 'Example Business Durban official website', maxResults: 5, country: 'south africa' },
    ...overrides,
  };
}

test('maps Tavily basic search results and keeps research read-only', async () => {
  let capturedBody = '';
  let capturedAuthorization = '';
  const integration = createTavilyPublicWebResearchIntegration({
    apiKey: 'tvly-test-secret',
    fetchImpl: async (_url, init) => {
      capturedBody = String(init?.body ?? '');
      capturedAuthorization = String((init?.headers as Record<string, string>)?.Authorization ?? '');
      return new Response(JSON.stringify({
        request_id: 'req-123',
        results: [{ title: 'Example Business', url: 'https://example.co.za/', content: 'Official website for Example Business.', score: 0.91 }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  });

  const response = await integration.execute(request());
  assert.equal(response.status, 'succeeded');
  assert.equal(response.externalReference, 'req-123');
  assert.deepEqual(response.output.results, [{ title: 'Example Business', url: 'https://example.co.za/', content: 'Official website for Example Business.', score: 0.91 }]);
  assert.deepEqual(response.evidenceReferences, ['public-web:https://example.co.za/']);
  assert.equal(capturedAuthorization, 'Bearer tvly-test-secret');
  assert.deepEqual(JSON.parse(capturedBody), {
    query: 'Example Business Durban official website', search_depth: 'basic', topic: 'general', include_answer: false,
    include_raw_content: false, include_images: false, max_results: 5, country: 'south africa',
  });
});

test('passes includeDomains through to Tavily as include_domains', async () => {
  let capturedBody: Record<string, unknown> | undefined;
  const integration = createTavilyPublicWebResearchIntegration({
    apiKey: 'tvly-test',
    fetchImpl: async (_url, init) => {
      capturedBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      return new Response(JSON.stringify({ results: [] }), { status: 200 });
    },
  });

  const response = await integration.execute(request({
    input: { query: 'team leadership', maxResults: 5, includeDomains: ['example.co.za'] },
  }));
  assert.equal(response.status, 'succeeded');
  assert.deepEqual(capturedBody?.include_domains, ['example.co.za']);
});

test('blocks agents outside Lead Agent and Human Executive authority', async () => {
  const integration = createTavilyPublicWebResearchIntegration({ apiKey: 'tvly-test', fetchImpl: async () => { throw new Error('provider should not be called'); } });
  const response = await integration.execute(request({ requestedBy: 'sales_agent' }));
  assert.equal(response.status, 'blocked');
});

test('blocks non-low-risk and non-live research requests', async () => {
  const integration = createTavilyPublicWebResearchIntegration({ apiKey: 'tvly-test', fetchImpl: async () => { throw new Error('provider should not be called'); } });
  assert.equal((await integration.execute(request({ risk: 'medium' }))).status, 'blocked');
  assert.equal((await integration.execute(request({ mode: 'draft' }))).status, 'blocked');
});

test('validates result cap before provider execution', async () => {
  let called = false;
  const integration = createTavilyPublicWebResearchIntegration({ apiKey: 'tvly-test', fetchImpl: async () => { called = true; return new Response('{}'); } });
  const response = await integration.execute(request({ input: { query: 'test', maxResults: 11 } }));
  assert.equal(response.status, 'failed');
  assert.equal(response.output.providerErrorCode, 'VALIDATION_ERROR');
  assert.equal(called, false);
});

test('marks network and provider throttling failures retryable without exposing API key', async () => {
  const integration = createTavilyPublicWebResearchIntegration({ apiKey: 'tvly-secret', fetchImpl: async () => { throw new Error('connection failed tvly-secret'); } });
  const network = await integration.execute(request());
  assert.equal(network.retryable, true);
  assert.equal(network.output.providerErrorCode, 'NETWORK_ERROR');
  assert.equal(network.output.providerErrorMessage?.includes('tvly-secret'), false);

  const throttledIntegration = createTavilyPublicWebResearchIntegration({ apiKey: 'tvly-secret', fetchImpl: async () => new Response(JSON.stringify({ detail: 'rate limited' }), { status: 429 }) });
  const throttled = await throttledIntegration.execute(request());
  assert.equal(throttled.status, 'failed');
  assert.equal(throttled.retryable, true);
  assert.equal(throttled.output.providerErrorCode, 'HTTP_429');
});
