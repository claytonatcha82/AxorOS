import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalizeGooglePlacesBusinessName, createLeadDiscoveryService } from './lead-discovery-service.js';

function lead(id: string, placeId: string, enrichmentStatus: 'pending' | 'verified' | 'not_found' | 'ambiguous' | 'not_applicable' = 'pending') {
  const now = new Date().toISOString();
  return { id, clientId: null, companyName: `Google Place ${placeId}`, contactName: null, contactEmail: null, source: 'google_places', opportunitySummary: null, leadScore: null, status: 'new', enrichmentStatus, evidence: [{ provider: 'google_places', providerPlaceId: placeId }], createdAt: now, updatedAt: now };
}

function createMock(existingPlaceId?: string, normalizedIdentity = false, existingEnrichmentStatus: 'pending' | 'verified' | 'not_found' | 'ambiguous' | 'not_applicable' = 'pending') {
  const events: unknown[] = [];
  const createdInputs: unknown[] = [];
  const identities: Array<{ provider: string; externalId: string; leadId: string }> = normalizedIdentity && existingPlaceId ? [{ provider: 'google_places', externalId: existingPlaceId, leadId: 'lead-existing' }] : [];
  const locks: string[] = [];
  const repository = {
    async lockLeadSourceIdentity(provider: string, externalId: string) { locks.push(`${provider}:${externalId}`); },
    async findLeadSourceIdentity(provider: string, externalId: string) { return identities.find((item) => item.provider === provider && item.externalId === externalId) ?? null; },
    async createLeadSourceIdentity(provider: string, externalId: string, leadId: string) { const identity = { provider, externalId, leadId }; identities.push(identity); return identity; },
    async getLeadById(id: string) { return id === 'lead-existing' ? lead(id, existingPlaceId ?? 'unknown', existingEnrichmentStatus) : null; },
    async findLeadByGooglePlaceId(placeId: string) { return !normalizedIdentity && existingPlaceId === placeId ? lead('lead-existing', placeId, existingEnrichmentStatus) : null; },
    async createLead(input: Record<string, unknown>) { createdInputs.push(input); const evidence = input.evidence as Array<{ providerPlaceId: string }>; return { ...lead('lead-new', evidence[0]?.providerPlaceId ?? 'unknown'), companyName: String(input.companyName), evidence: input.evidence }; },
    async createWorkflowEvent(input: unknown) { events.push(input); return { id: 'event-1' }; },
  };
  return { repository, events, createdInputs, identities, locks, runInTransaction: async (work: (tx: typeof repository) => Promise<unknown>) => work(repository) };
}

test('canonicalizes explicit Google Places UI prefixes without broadly rewriting names', () => {
  assert.equal(canonicalizeGooglePlacesBusinessName('Contact our Office - Sebedisan Construction'), 'Sebedisan Construction');
  assert.equal(canonicalizeGooglePlacesBusinessName('Home - GIBB'), 'GIBB');
  assert.equal(canonicalizeGooglePlacesBusinessName('Example Construction Group'), 'Example Construction Group');
});

test('canonicalizes Google Place ID fallback to an unusable name', () => {
  assert.equal(canonicalizeGooglePlacesBusinessName('Google Place ChIJ123abc'), '');
  assert.equal(canonicalizeGooglePlacesBusinessName('ChIJ123abc'), '');
});

test('canonicalizes a bare Google Place prefix to an unusable name', () => {
  assert.equal(canonicalizeGooglePlacesBusinessName('Google Place '), '');
});

test('does not strip legitimate business names containing Google or Place', () => {
  assert.equal(canonicalizeGooglePlacesBusinessName('Google Workspace Solutions'), 'Google Workspace Solutions');
  assert.equal(canonicalizeGooglePlacesBusinessName('Place Makers Hardware'), 'Place Makers Hardware');
});

test('persists the canonicalized Google Places business identity', async () => {
  const mock = createMock();
  const service = createLeadDiscoveryService(mock.repository as never, mock.runInTransaction as never);
  const result = await service.persistDiscovery({ discovery: { query: 'businesses in Durban, South Africa', candidates: [{ providerPlaceId: 'place-123', displayName: 'Contact our Office - Example Business', formattedAddress: 'Durban', types: ['establishment'], source: 'google_places' }] } });
  assert.equal(result.created.length, 1);
  assert.equal(result.created[0]?.companyName, 'Example Business');
  assert.deepEqual(mock.identities, [{ provider: 'google_places', externalId: 'place-123', leadId: 'lead-new' }]);
  assert.deepEqual(mock.locks, ['google_places:place-123']);
  assert.equal(mock.events.length, 1);
});

test('does not persist Google address, types, or search query', async () => {
  const mock = createMock();
  const service = createLeadDiscoveryService(mock.repository as never, mock.runInTransaction as never);
  await service.persistDiscovery({ discovery: { query: 'sensitive search query', candidates: [{ providerPlaceId: 'place-123', displayName: 'Provider Business Name', formattedAddress: 'Provider Address', types: ['provider_type'], source: 'google_places' }] } });
  const persisted = JSON.stringify({ input: mock.createdInputs[0], event: mock.events[0], identities: mock.identities });
  assert.equal(persisted.includes('Provider Business Name'), true);
  assert.equal(persisted.includes('Provider Address'), false);
  assert.equal(persisted.includes('provider_type'), false);
  assert.equal(persisted.includes('sensitive search query'), false);
});

test('deduplicates using normalized provider identity before creating a lead', async () => {
  const mock = createMock('place-123', true, 'pending');
  const service = createLeadDiscoveryService(mock.repository as never, mock.runInTransaction as never);
  const result = await service.persistDiscovery({ discovery: { query: 'Durban businesses', candidates: [{ providerPlaceId: 'place-123', displayName: 'Example Business', types: [], source: 'google_places' }] } });
  assert.deepEqual(result.duplicates, [{ providerPlaceId: 'place-123', leadId: 'lead-existing', enrichmentPending: true }]);
  assert.equal(mock.createdInputs.length, 0);
});

test('does not treat an already enriched lead as enrichment-pending', async () => {
  const mock = createMock('place-123', true, 'not_found');
  const service = createLeadDiscoveryService(mock.repository as never, mock.runInTransaction as never);
  const result = await service.persistDiscovery({ discovery: { query: 'Durban businesses', candidates: [{ providerPlaceId: 'place-123', displayName: 'Example Business', types: [], source: 'google_places' }] } });
  assert.deepEqual(result.duplicates, [{ providerPlaceId: 'place-123', leadId: 'lead-existing', enrichmentPending: false }]);
});

test('claims a legacy JSONB-only discovery identity instead of duplicating the lead', async () => {
  const mock = createMock('place-legacy', false, 'pending');
  const service = createLeadDiscoveryService(mock.repository as never, mock.runInTransaction as never);
  const result = await service.persistDiscovery({ discovery: { query: 'businesses', candidates: [{ providerPlaceId: 'place-legacy', displayName: 'Legacy Business', types: [], source: 'google_places' }] } });
  assert.deepEqual(result.duplicates, [{ providerPlaceId: 'place-legacy', leadId: 'lead-existing', enrichmentPending: true }]);
  assert.deepEqual(mock.identities, [{ provider: 'google_places', externalId: 'place-legacy', leadId: 'lead-existing' }]);
  assert.equal(mock.createdInputs.length, 0);
});

test('skips a provider-ID-only candidate instead of persisting it as a lead', async () => {
  const mock = createMock();
  const service = createLeadDiscoveryService(mock.repository as never, mock.runInTransaction as never);
  const result = await service.persistDiscovery({ discovery: { query: 'businesses', candidates: [{ providerPlaceId: 'place-123', displayName: 'Google Place ChIJ123abc', types: [], source: 'google_places' }] } });
  assert.deepEqual(result.created, []);
  assert.deepEqual(result.duplicates, []);
  assert.deepEqual(result.skipped, [{ providerPlaceId: 'place-123', reason: 'Unusable displayName: provider ID fallback or empty after canonicalization.' }]);
  assert.equal(mock.createdInputs.length, 0);
});

test('skips a bare Google Place fallback instead of persisting it as a lead', async () => {
  const mock = createMock();
  const service = createLeadDiscoveryService(mock.repository as never, mock.runInTransaction as never);
  const result = await service.persistDiscovery({ discovery: { query: 'businesses', candidates: [{ providerPlaceId: 'place-empty', displayName: 'Google Place ', types: [], source: 'google_places' }] } });
  assert.equal(result.created.length, 0);
  assert.equal(result.skipped.length, 1);
  assert.equal(result.skipped[0]?.providerPlaceId, 'place-empty');
  assert.equal(mock.createdInputs.length, 0);
});

test('fails closed when provider identity is missing', async () => {
  const mock = createMock();
  const service = createLeadDiscoveryService(mock.repository as never, mock.runInTransaction as never);
  await assert.rejects(() => service.persistDiscovery({ discovery: { query: 'Durban businesses', candidates: [{ providerPlaceId: ' ', displayName: 'Example', types: [], source: 'google_places' }] } }), /candidate.providerPlaceId is required/);
});

test('fails closed when provider display name is missing', async () => {
  const mock = createMock();
  const service = createLeadDiscoveryService(mock.repository as never, mock.runInTransaction as never);
  await assert.rejects(() => service.persistDiscovery({ discovery: { query: 'Durban businesses', candidates: [{ providerPlaceId: 'place-123', displayName: ' ', types: [], source: 'google_places' }] } }), /candidate.displayName is required/);
});
