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
  assert.equal(headers['X-Goog-FieldMask'], 'places.id,places.displayName.text,places.formattedAddress,places.addressComponents,places.types,nextPageToken');
  assert.deepEqual(JSON.parse(String(capturedInit?.body)), {
    textQuery: 'plumbers in Durban South Africa',
    maxResultCount: 5,
    regionCode: 'ZA',
  });
});

test('Google Places lead research rejects purely geographic and political results before candidate creation', async () => {
  const integration = createGooglePlacesLeadResearchIntegration({
    apiKey: 'test-google-places-key',
    fetchImpl: async () => new Response(JSON.stringify({
      places: [
        { id: 'place-locality', displayName: { text: 'Kootwijkerbroek' }, types: ['locality', 'political'] },
        { id: 'place-country', displayName: { text: 'South Africa' }, types: ['country', 'political'] },
        { id: 'place-business', displayName: { text: 'Example Plumbing' }, types: ['plumber', 'establishment'] },
      ],
    }), { status: 200 }),
  });

  const result = await integration.execute(request());

  assert.equal(result.status, 'succeeded');
  assert.deepEqual(result.output.candidates.map((candidate) => candidate.displayName), ['Example Plumbing']);
