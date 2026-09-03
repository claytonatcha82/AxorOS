import assert from 'node:assert/strict';
import test from 'node:test';
import { createLeadPublicWebEnrichmentService } from './lead-public-web-enrichment-service.js';

function discoveredLead(enrichmentStatus: 'pending' | 'verified' | 'not_found' | 'ambiguous' | 'not_applicable' = 'pending') {
  const now = new Date().toISOString();
  return { id: 'lead-1', clientId: null, companyName: 'Google Place place-123', contactName: null, contactEmail: null, source: 'google_places', opportunitySummary: null, leadScore: null, status: 'new', enrichmentStatus, evidence: [{ kind: 'lead_discovery', provider: 'google_places', providerPlaceId: 'place-123', evidenceReference: 'google-places:place:place-123' }], createdAt: now, updatedAt: now };
}

function mockRepository(initialStatus: 'pending' | 'verified' | 'not_found' | 'ambiguous' | 'not_applicable' = 'pending') {
  const events: unknown[] = [];
  const enrichments: Array<{ id: string; expectedStatus: string; input: Record<string, unknown>; nextStatus: string }> = [];
  const repository = {
    async getLeadById() { return discoveredLead(initialStatus); },
    async enrichLead(id: string, expectedStatus: string, input: Record<string, unknown>, nextStatus: string) { enrichments.push({ id, expectedStatus, input, nextStatus }); return { ...discoveredLead(), companyName: String(input.companyName), opportunitySummary: String(input.opportunitySummary), enrichmentStatus: nextStatus, evidence: input.evidence }; },
    async createWorkflowEvent(input: unknown) { events.push(input); return { id: 'event-1' }; },
  };
  return { repository, events, enrichments, runInTransaction: async (work: (tx: typeof repository) => Promise<unknown>) => work(repository) };
}

test('promotes a pending Google discovery using independently sourced website evidence', async () => {
  const mock = mockRepository();
  const service = createLeadPublicWebEnrichmentService(mock.repository as never, mock.runInTransaction as never);
  const result = await service.enrich({ leadId: 'lead-1', companyName: 'Example Business', officialWebsiteUrl: 'https://example.co.za/', supportingResults: [{ title: 'Example Business', url: 'https://example.co.za/', content: 'Official website for Example Business.' }] });
  assert.equal(result.companyName, 'Example Business');
  assert.equal(result.enrichmentStatus, 'verified');
  assert.equal(mock.enrichments.length, 1);
  assert.equal(mock.enrichments[0]?.expectedStatus, 'pending');
  assert.equal(mock.enrichments[0]?.nextStatus, 'verified');
  assert.equal(mock.events.length, 1);
});

test('marks a pending discovery not_found when no official website is verified', async () => {
  const mock = mockRepository();
  const service = createLeadPublicWebEnrichmentService(mock.repository as never, mock.runInTransaction as never);
  const result = await service.enrich({ leadId: 'lead-1', companyName: 'Example Business', supportingResults: [{ title: 'Example Business directory', url: 'https://directory.example/results/example', content: 'Example Business listing.' }] });
  assert.equal(result.enrichmentStatus, 'not_found');
  assert.equal(mock.enrichments[0]?.nextStatus, 'not_found');
});

test('rejects an official website that is not supported by research results', async () => {
  const mock = mockRepository();
  const service = createLeadPublicWebEnrichmentService(mock.repository as never, mock.runInTransaction as never);
  await assert.rejects(() => service.enrich({ leadId: 'lead-1', companyName: 'Example Business', officialWebsiteUrl: 'https://example.co.za/', supportingResults: [{ title: 'Other', url: 'https://other.co.za/', content: 'Other site.' }] }), /must be supported/);
  assert.equal(mock.enrichments.length, 0);
});

test('rejects a lead that is already enriched and requires an explicit requeue', async () => {
  const mock = mockRepository('not_found');
  const service = createLeadPublicWebEnrichmentService(mock.repository as never, mock.runInTransaction as never);
  await assert.rejects(() => service.enrich({ leadId: 'lead-1', companyName: 'Example Business', officialWebsiteUrl: 'https://example.co.za/', supportingResults: [{ title: 'Example', url: 'https://example.co.za/', content: 'Example.' }] }), /requires an explicit requeue/);
  assert.equal(mock.enrichments.length, 0);
});
