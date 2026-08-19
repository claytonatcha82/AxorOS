import assert from 'node:assert/strict';
import test from 'node:test';
import { createLeadDiscoveryService } from './lead-discovery-service.js';

function lead(id: string, placeId: string) {
  const now = new Date().toISOString();
  return {
    id,
    clientId: null,
    companyName: `Google Place ${placeId}`,
    contactName: null,
    contactEmail: null,
    source: 'google_places',
    opportunitySummary: null,
    leadScore: null,
    status: 'new',
    evidence: [{ provider: 'google_places', providerPlaceId: placeId }],
    createdAt: now,
    updatedAt: now,
  };
}

function createMock(existingPlaceId?: string) {
  const events: unknown[] = [];
  const createdInputs: unknown[] = [];
  const repository = {
    async findLeadByGooglePlaceId(placeId: string) {
      return existingPlaceId === placeId ? lead('lead-existing', placeId) : null;
    },
    async createLead(input: Record<string, unknown>) {
      createdInputs.push(input);
      const evidence = input.evidence as Array<{ providerPlaceId: string }>;
      return { ...lead('lead-new', evidence[0]?.providerPlaceId ?? 'unknown'), companyName: String(input.companyName), evidence: input.evidence };
    },
    async createWorkflowEvent(input: unknown) {
      events.push(input);
      return { id: 'event-1' };
    },
  };
  return {
    repository,
    events,
    createdInputs,
    runInTransaction: async (work: (tx: typeof repository) => Promise<unknown>) => work(repository),
  };
}

test('persists only storage-safe Google Place identity and internal metadata', async () => {
  const mock = createMock();
  const service = createLeadDiscoveryService(mock.repository as never, mock.runInTransaction as never);
  const result = await service.persistDiscovery({
    discovery: {
      query: 'web design businesses in Durban, South Africa',
      candidates: [{ providerPlaceId: 'place-123', displayName: 'Example Business', formattedAddress: 'Durban', types: ['establishment'], source: 'google_places' }],
    },
  });

  assert.equal(result.created.length, 1);
  assert.equal(result.duplicates.length, 0);
  assert.deepEqual(mock.createdInputs[0], {
    companyName: 'Google Place place-123',
    source: 'google_places',
    evidence: [{ kind: 'lead_discovery', provider: 'google_places', providerPlaceId: 'place-123', evidenceReference: 'google-places:place:place-123' }],
  });
  assert.equal(mock.events.length, 1);
  assert.deepEqual(mock.events[0], {
    eventType: 'lead_discovered',
    actorType: 'agent',
    actorId: 'lead_agent',
    payload: { leadId: 'lead-new', provider: 'google_places', providerPlaceId: 'place-123', evidenceReference: 'google-places:place:place-123' },
  });
});

test('does not persist Google display name, address, types, or search query', async () => {
  const mock = createMock();
  const service = createLeadDiscoveryService(mock.repository as never, mock.runInTransaction as never);
  await service.persistDiscovery({
    discovery: {
      query: 'sensitive search query',
      candidates: [{ providerPlaceId: 'place-123', displayName: 'Provider Business Name', formattedAddress: 'Provider Address', types: ['provider_type'], source: 'google_places' }],
    },
  });

  const persisted = JSON.stringify({ input: mock.createdInputs[0], event: mock.events[0] });
  assert.equal(persisted.includes('Provider Business Name'), false);
  assert.equal(persisted.includes('Provider Address'), false);
  assert.equal(persisted.includes('provider_type'), false);
  assert.equal(persisted.includes('sensitive search query'), false);
});

test('deduplicates by Google Place ID and does not create another lead or event', async () => {
  const mock = createMock('place-123');
  const service = createLeadDiscoveryService(mock.repository as never, mock.runInTransaction as never);
  const result = await service.persistDiscovery({
    discovery: { query: 'Durban businesses', candidates: [{ providerPlaceId: 'place-123', displayName: 'Example Business', types: [], source: 'google_places' }] },
  });

  assert.equal(result.created.length, 0);
  assert.deepEqual(result.duplicates, [{ providerPlaceId: 'place-123', leadId: 'lead-existing' }]);
  assert.equal(mock.createdInputs.length, 0);
  assert.equal(mock.events.length, 0);
});

test('fails closed when provider identity is missing', async () => {
  const mock = createMock();
  const service = createLeadDiscoveryService(mock.repository as never, mock.runInTransaction as never);
  await assert.rejects(() => service.persistDiscovery({
    discovery: { query: 'Durban businesses', candidates: [{ providerPlaceId: ' ', displayName: 'Example', types: [], source: 'google_places' }] },
  }), /candidate.providerPlaceId is required/);
});
