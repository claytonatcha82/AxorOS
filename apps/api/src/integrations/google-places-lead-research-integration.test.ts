import assert from 'node:assert/strict';
import test from 'node:test';
import { createGooglePlacesLeadResearchIntegration } from './google-places-lead-research-integration.js';

function request(overrides: Record<string, unknown> = {}) {
  return {
    integrationId: 'research.google-places',
    operation: 'search_businesses',
    requestedBy: 'lead_agent' as const,
    executionId: 'exec-lead-research-1',
    correlationId: 'corr-lead-research-1',
    mode: 'live' as const,
    risk: 'low' as const,
    input: { query: 'plumbers in Durban South Africa', maxResults: 5 },
    ...overrides,
  };
}

test('Google Places lead research performs cost-bounded read-only business search', async () => {
  let capturedUrl = '';
  let capturedInit: RequestInit | undefined;
  const integration = createGooglePlacesLeadResearchIntegration({
    apiKey: 'test-google-places-key',
    fetchImpl: async (url, init) => {
      capturedUrl = String(url);
      capturedInit = init;
      return new Response(JSON.stringify({
        places: [
          {
            id: 'place-123',
            displayName: { text: 'Example Plumbing' },
            formattedAddress: 'Durban, South Africa',
            types: ['plumber', 'establishment'],
          },
        ],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });

  const result = await integration.execute(request());

  assert.equal(result.status, 'succeeded');
  assert.equal(result.provider, 'google-places');
  assert.equal(result.output.candidates.length, 1);
  assert.equal(result.output.nextPageToken, undefined);
  assert.deepEqual(result.output.candidates[0], {
    providerPlaceId: 'place-123',
    displayName: 'Example Plumbing',
    formattedAddress: 'Durban, South Africa',
    types: ['plumber', 'establishment'],
    source: 'google_places',
  });
  assert.deepEqual(result.evidenceReferences, ['google-places:place:place-123']);
  assert.equal(capturedUrl, 'https://places.googleapis.com/v1/places:searchText');
  const headers = capturedInit?.headers as Record<string, string>;
  assert.equal(headers['X-Goog-Api-Key'], 'test-google-places-key');
  assert.equal(headers['X-Goog-FieldMask'], 'places.id,places.displayName.text,places.formattedAddress,places.types,nextPageToken');
  assert.deepEqual(JSON.parse(String(capturedInit?.body)), {
    textQuery: 'plumbers in Durban South Africa',
    maxResultCount: 5,
  });
});

test('Google Places lead research passes pagination token and returns next page token', async () => {
  let capturedInit: RequestInit | undefined;
  const integration = createGooglePlacesLeadResearchIntegration({
    apiKey: 'test-google-places-key',
    fetchImpl: async (_url, init) => {
      capturedInit = init;
      return new Response(JSON.stringify({
        places: [
          {
            id: 'place-456',
            displayName: { text: 'Second Page Plumbing' },
            formattedAddress: 'Durban, South Africa',
            types: ['plumber'],
          },
        ],
        nextPageToken: 'next-page-token-123',
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });

  const result = await integration.execute(request({
    input: {
      query: 'plumbers in Durban South Africa',
      maxResults: 20,
      pageToken: 'current-page-token-123',
    },
  }));

  assert.equal(result.status, 'succeeded');
  assert.equal(result.output.nextPageToken, 'next-page-token-123');
  assert.deepEqual(JSON.parse(String(capturedInit?.body)), {
    textQuery: 'plumbers in Durban South Africa',
    maxResultCount: 20,
    pageToken: 'current-page-token-123',
  });
});

test('Google Places lead research accepts long pagination tokens from the provider', async () => {
  let calls = 0;
  const longToken = 'x'.repeat(201);
  const integration = createGooglePlacesLeadResearchIntegration({
    apiKey: 'test-key',
    fetchImpl: async () => {
      calls += 1;
      return new Response(JSON.stringify({ places: [] }), { status: 200 });
    },
  });

  const result = await integration.execute(request({
    input: {
      query: 'businesses in Durban',
      pageToken: longToken,
    },
  }));

  assert.equal(result.status, 'succeeded');
  assert.equal(calls, 1);
});

test('Google Places lead research blocks excessively large pagination tokens', async () => {
  let calls = 0;
  const integration = createGooglePlacesLeadResearchIntegration({
    apiKey: 'test-key',
    fetchImpl: async () => { calls += 1; return new Response('{}', { status: 200 }); },
  });

  const result = await integration.execute(request({
    input: {
      query: 'businesses in Durban',
      pageToken: 'x'.repeat(4097),
    },
  }));

  assert.equal(result.status, 'blocked');
  assert.equal(calls, 0);
});

test('Google Places lead research blocks non-Lead agents', async () => {
  let calls = 0;
  const integration = createGooglePlacesLeadResearchIntegration({
    apiKey: 'test-key',
    fetchImpl: async () => { calls += 1; return new Response('{}', { status: 200 }); },
  });

  const result = await integration.execute(request({ requestedBy: 'sales_agent' }));
  assert.equal(result.status, 'blocked');
  assert.equal(calls, 0);
});

test('Google Places lead research blocks anything above low risk', async () => {
  let calls = 0;
  const integration = createGooglePlacesLeadResearchIntegration({
    apiKey: 'test-key',
    fetchImpl: async () => { calls += 1; return new Response('{}', { status: 200 }); },
  });

  const result = await integration.execute(request({ risk: 'medium' }));
  assert.equal(result.status, 'blocked');
  assert.equal(calls, 0);
});

test('Google Places lead research validates result cap before provider execution', async () => {
  let calls = 0;
  const integration = createGooglePlacesLeadResearchIntegration({
    apiKey: 'test-key',
    fetchImpl: async () => { calls += 1; return new Response('{}', { status: 200 }); },
  });

  const result = await integration.execute(request({ input: { query: 'businesses in Durban', maxResults: 21 } }));
  assert.equal(result.status, 'blocked');
  assert.equal(calls, 0);
});

test('Google Places lead research marks network failures retryable without evidence', async () => {
  const integration = createGooglePlacesLeadResearchIntegration({
    apiKey: 'test-key',
    fetchImpl: async () => { throw new Error('network down'); },
  });

  const result = await integration.execute(request());
  assert.equal(result.status, 'failed');
  assert.equal(result.retryable, true);
  assert.deepEqual(result.evidenceReferences, []);
});
