import assert from 'node:assert/strict';
import test from 'node:test';
import { createLeadPublicWebEnrichmentService } from './lead-public-web-enrichment-service.js';

function discoveredLead() {
  const now = new Date().toISOString();
  return { id: 'lead-1', clientId: null, companyName: 'Google Place place-123', contactName: null, contactEmail: null, source: 'google_places', opportunitySummary: null, leadScore: null, status: 'new', evidence: [{ kind: 'lead_discovery', provider: 'google_places', providerPlaceId: 'place-123', evidenceReference: 'google-places:place:place-123' }], createdAt: now, updatedAt: now };
}

function mockRepository() {
  const events: unknown[] = [];
  const enrichments: unknown[] = [];
  const repository = {
    async getLeadById() { return discoveredLead(); },
    async enrichLead(id: string, expected: string, input: Record<string, unknown>) { enrichments.push({ id, expected, input }); return { ...discoveredLead(), companyName: String(input.companyName), opportunitySummary: String(input.opportunitySummary), evidence: input.evidence }; },
    async createWorkflowEvent(input: unknown) { events.push(input); return { id: 'event-1' }; },
  };
  return { repository, events, enrichments, runInTransaction: async (work: (tx: typeof repository) => Promise<unknown>) => work(repository) };
}

test('promotes a Google discovery using independently sourced website evidence', async () => {
  const mock = mockRepository();
  const service = createLeadPublicWebEnrichmentService(mock.repository as never, mock.runInTransaction as never);
  const result = await service.enrich({ leadId: 'lead-1', companyName: 'Example Business', officialWebsiteUrl: 'https://example.co.za/', supportingResults: [{ title: 'Example Business', url: 'https://example.co.za/', content: 'Official website for Example Business.' }] });
  assert.equal(result.companyName, 'Example Business');
  assert.equal(mock.enrichments.length, 1);
  assert.equal(mock.events.length, 1);
  assert.match(JSON.stringify(mock.enrichments[0]), /public_web_enrichment/);
  assert.match(JSON.stringify(mock.enrichments[0]), /https:\/\/example.co.za\//);
});

test('rejects an official website that is not supported by research results', async () => {
  const mock = mockRepository();
  const service = createLeadPublicWebEnrichmentService(mock.repository as never, mock.runInTransaction as never);
  await assert.rejects(() => service.enrich({ leadId: 'lead-1', companyName: 'Example Business', officialWebsiteUrl: 'https://example.co.za/', supportingResults: [{ title: 'Other', url: 'https://other.co.za/', content: 'Other site.' }] }), /must be supported/);
  assert.equal(mock.enrichments.length, 0);
});

test('rejects a lead that is already enriched', async () => {
  const mock = mockRepository();
  mock.repository.getLeadById = async () => ({ ...discoveredLead(), companyName: 'Already Enriched' });
  const service = createLeadPublicWebEnrichmentService(mock.repository as never, mock.runInTransaction as never);
  await assert.rejects(() => service.enrich({ leadId: 'lead-1', companyName: 'Example Business', officialWebsiteUrl: 'https://example.co.za/', supportingResults: [{ title: 'Example', url: 'https://example.co.za/', content: 'Example.' }] }), /already been enriched/);
  assert.equal(mock.enrichments.length, 0);
});
