import assert from 'node:assert/strict';
import test from 'node:test';
import { createLeadDiscoveryService } from './lead-discovery-service.js';

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

test('persists only storage-safe Google Place identity and internal metadata', async () => {
  const mock = createMock();
  const service = createLeadDiscoveryService(mock.repository as never, mock.runInTransaction as never);
  const result = await service.persistDiscovery({ discovery: { query: 'businesses in Durban, South Africa', candidates: [{ providerPlaceId: 'place-123', displayName: 'Example Business', formattedAddress: 'Durban', types: ['establishment'], source: 'google_places' }] } });
  assert.equal(result.created.length, 1);
  assert.deepEqual(mock.identities, [{ provider: 'google_places', externalId: 'place-123', leadId: 'lead-new' }]);
  assert.deepEqual(mock.locks, ['google_places:place-123']);
  assert.equal(mock.events.length, 1);
});

test('does not persist Google display name, address, types, or search query', async () => {
  const mock = createMock();
  const service = createLeadDiscoveryService(mock.repository as never, mock.runInTransaction as never);
  await service.persistDiscovery({ discovery: { query: 'sensitive search query', candidates: [{ providerPlaceId: 'place-123', displayName: 'Provider Business Name', formattedAddress: 'Provider Address', types: ['provider_type'], source: 'google_places' }] } });
  const persisted = JSON.stringify({ input: mock.createdInputs[0], event: mock.events[0], identities: mock.identities });
  assert.equal(persisted.includes('Provider Business Name'), false);
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
  assert.equal(mock.events.length, 0);
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

test('fails closed when provider identity is missing', async () => {
  const mock = createMock();
  const service = createLeadDiscoveryService(mock.repository as never, mock.runInTransaction as never);
  await assert.rejects(() => service.persistDiscovery({ discovery: { query: 'Durban businesses', candidates: [{ providerPlaceId: ' ', displayName: 'Example', types: [], source: 'google_places' }] } }), /candidate.providerPlaceId is required/);
});
