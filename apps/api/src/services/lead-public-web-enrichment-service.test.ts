import assert from 'node:assert/strict';
import test from 'node:test';
import { createLeadPublicWebEnrichmentService } from './lead-public-web-enrichment-service.js';

function discoveredLead(enrichmentStatus: 'pending' | 'verified' | 'not_found' | 'ambiguous' | 'not_applicable' = 'pending', companyName = 'Example Business') {
  const now = new Date().toISOString();
  return { id: 'lead-1', clientId: null, companyName, contactName: null, contactEmail: null, source: 'google_places', opportunitySummary: null, leadScore: null, status: 'new', enrichmentStatus, evidence: [{ kind: 'lead_discovery', provider: 'google_places', providerPlaceId: 'place-123', evidenceReference: 'google-places:place:place-123' }], createdAt: now, updatedAt: now };
}

function mockRepository(initialStatus: 'pending' | 'verified' | 'not_found' | 'ambiguous' | 'not_applicable' = 'pending', companyName = 'Example Business') {
  const events: unknown[] = [];
  const enrichments: Array<{ id: string; expectedStatus: string; input: Record<string, unknown>; nextStatus: string }> = [];
  const repository = {
    async getLeadById() { return discoveredLead(initialStatus, companyName); },
    async enrichLead(id: string, expectedStatus: string, input: Record<string, unknown>, nextStatus: string) { enrichments.push({ id, expectedStatus, input, nextStatus }); return { ...discoveredLead(), companyName: String(input.companyName), contactName: input.contactName ? String(input.contactName) : null, contactEmail: input.contactEmail ? String(input.contactEmail) : null, opportunitySummary: String(input.opportunitySummary), enrichmentStatus: nextStatus, evidence: input.evidence }; },
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

test('discovers and persists an explicit public business email from the verified official domain', async () => {
  const mock = mockRepository();
  const service = createLeadPublicWebEnrichmentService(mock.repository as never, mock.runInTransaction as never);
  const result = await service.enrich({
    leadId: 'lead-1',
    companyName: 'Example Business',
    officialWebsiteUrl: 'https://example.co.za/',
    supportingResults: [
      { title: 'Example Business Contact', url: 'https://example.co.za/contact', content: 'Contact us at info@example.co.za or call our office.' },
      { title: 'Example Business About', url: 'https://example.co.za/about', content: 'Example Business serves South African clients.' },
    ],
  });
  assert.equal(result.contactEmail, 'info@example.co.za');
  assert.equal(mock.enrichments[0]?.input.contactEmail, 'info@example.co.za');
  const evidence = mock.enrichments[0]?.input.evidence as Array<Record<string, unknown>>;
  const enrichmentEvidence = evidence.find((item) => item.kind === 'public_web_enrichment');
  assert.equal(enrichmentEvidence?.contactEmail, 'info@example.co.za');
  assert.deepEqual(enrichmentEvidence?.contactEmailEvidenceReferences, ['public-web:https://example.co.za/contact']);
});

test('prefers a deterministic business contact mailbox and does not use a no-reply address', async () => {
  const mock = mockRepository();
  const service = createLeadPublicWebEnrichmentService(mock.repository as never, mock.runInTransaction as never);
  const result = await service.enrich({
    leadId: 'lead-1',
    companyName: 'Example Business',
    officialWebsiteUrl: 'https://example.co.za/',
    supportingResults: [{
      title: 'Example Business',
      url: 'https://example.co.za/',
      content: 'sales@example.co.za info@example.co.za noreply@example.co.za',
    }],
  });
  assert.equal(result.contactEmail, 'info@example.co.za');
});

test('does not extract an email from an unrelated or third-party research domain', async () => {
  const mock = mockRepository();
  const service = createLeadPublicWebEnrichmentService(mock.repository as never, mock.runInTransaction as never);
  const result = await service.enrich({
    leadId: 'lead-1',
    companyName: 'Example Business',
    officialWebsiteUrl: 'https://example.co.za/',
    supportingResults: [
      { title: 'Example Business', url: 'https://example.co.za/', content: 'Official website for Example Business.' },
      { title: 'Example Business directory', url: 'https://directory.example/contact', content: 'contact@directory.example' },
    ],
  });
  assert.equal(result.contactEmail, null);
  assert.equal(mock.enrichments[0]?.input.contactEmail, undefined);
});

test('marks a pending discovery not_found when no official website is verified', async () => {
  const mock = mockRepository();
  const service = createLeadPublicWebEnrichmentService(mock.repository as never, mock.runInTransaction as never);
  const result = await service.enrich({ leadId: 'lead-1', companyName: 'Example Business', supportingResults: [{ title: 'Example Business directory', url: 'https://directory.example/results/example', content: 'Example Business listing.' }] });
  assert.equal(result.enrichmentStatus, 'not_found'); assert.equal(mock.enrichments[0]?.nextStatus, 'not_found');
});

test('rejects an official website that is not supported by research results', async () => { const mock = mockRepository(); const service = createLeadPublicWebEnrichmentService(mock.repository as never, mock.runInTransaction as never); await assert.rejects(() => service.enrich({ leadId: 'lead-1', companyName: 'Example Business', officialWebsiteUrl: 'https://example.co.za/', supportingResults: [{ title: 'Other', url: 'https://other.co.za/', content: 'Other site.' }] }), /must be supported/); assert.equal(mock.enrichments.length, 0); });
test('rejects a known third-party directory as the official website', async () => { const mock = mockRepository('pending', 'Power Construction (Pty) Ltd'); const service = createLeadPublicWebEnrichmentService(mock.repository as never, mock.runInTransaction as never); const result = await service.enrich({ leadId: 'lead-1', companyName: 'Power Construction (Pty) Ltd', officialWebsiteUrl: 'https://rocketreach.co/power-construction-profile', supportingResults: [{ title: 'Power Construction (Pty) Ltd Information', url: 'https://rocketreach.co/power-construction-profile', content: 'Power Construction company profile.' }] }); assert.equal(result.enrichmentStatus, 'not_found'); assert.equal(mock.enrichments[0]?.input.officialWebsiteUrl, undefined); assert.equal(mock.enrichments[0]?.input.companyName, 'Power Construction (Pty) Ltd'); });
test('rejects an industry directory domain even when the company name appears in the listing', async () => { const mock = mockRepository('pending', 'Dennes Engineering'); const service = createLeadPublicWebEnrichmentService(mock.repository as never, mock.runInTransaction as never); const result = await service.enrich({ leadId: 'lead-1', companyName: 'Dennes Engineering', officialWebsiteUrl: 'https://www.engnet.co.za/', supportingResults: [{ title: 'Dennes Engineering :: Contact Us - Cape Town', url: 'https://www.engnet.co.za/', content: 'Dennes Engineering profile on EngNet.' }] }); assert.equal(result.enrichmentStatus, 'not_found'); assert.equal(mock.enrichments[0]?.input.officialWebsiteUrl, undefined); });
test('rejects a jobs portal domain even when the company name appears in the listing', async () => { const mock = mockRepository('pending', 'GVK Siya-Zama Building Contractors Gauteng (Pty) Ltd'); const service = createLeadPublicWebEnrichmentService(mock.repository as never, mock.runInTransaction as never); const result = await service.enrich({ leadId: 'lead-1', companyName: 'GVK Siya-Zama Building Contractors Gauteng (Pty) Ltd', officialWebsiteUrl: 'https://gvkjobs.mcidirecthire.com/', supportingResults: [{ title: 'GVK Siya-Zama Building Contractors Gauteng', url: 'https://gvkjobs.mcidirecthire.com/', content: 'GVK Siya-Zama Building Contractors job vacancies.' }] }); assert.equal(result.enrichmentStatus, 'not_found'); assert.equal(mock.enrichments[0]?.input.officialWebsiteUrl, undefined); });
test('rejects an industry aggregation domain when only a generic company token matches', async () => { const mock = mockRepository('pending', 'Motheo Construction Group'); const service = createLeadPublicWebEnrichmentService(mock.repository as never, mock.runInTransaction as never); const result = await service.enrich({ leadId: 'lead-1', companyName: 'Motheo Construction Group', officialWebsiteUrl: 'https://constructioncompanies.co.za/', supportingResults: [{ title: 'Construction Companies South Africa', url: 'https://constructioncompanies.co.za/', content: 'Construction companies directory.' }] }); assert.equal(result.enrichmentStatus, 'not_found'); assert.equal(mock.enrichments[0]?.input.officialWebsiteUrl, undefined); });
test('accepts a matching company domain without replacing the canonical company name with a page title', async () => { const mock = mockRepository('pending', 'Zutari'); const service = createLeadPublicWebEnrichmentService(mock.repository as never, mock.runInTransaction as never); const result = await service.enrich({ leadId: 'lead-1', companyName: 'Terms of Use - Zutari', officialWebsiteUrl: 'https://www.zutari.com/', supportingResults: [{ title: 'Terms of Use - Zutari', url: 'https://www.zutari.com/terms-of-use', content: 'Zutari is an engineering and advisory business.' }] }); assert.equal(result.companyName, 'Zutari'); assert.equal(result.enrichmentStatus, 'verified'); assert.equal(mock.enrichments[0]?.input.companyName, 'Zutari'); });
test('rejects a plausible but unrelated domain when research does not establish company identity', async () => { const mock = mockRepository('pending', 'Tiber Construction (Pty) Ltd'); const service = createLeadPublicWebEnrichmentService(mock.repository as never, mock.runInTransaction as never); const result = await service.enrich({ leadId: 'lead-1', companyName: 'Tiber Construction (Pty) Ltd', officialWebsiteUrl: 'https://www.mbanorth.co.za/', supportingResults: [{ title: 'MBA North', url: 'https://www.mbanorth.co.za/', content: 'Master Builders Association North.' }] }); assert.equal(result.enrichmentStatus, 'not_found'); assert.equal(mock.enrichments[0]?.input.officialWebsiteUrl, undefined); });
test('rejects a lead that is already enriched and requires an explicit requeue', async () => { const mock = mockRepository('not_found'); const service = createLeadPublicWebEnrichmentService(mock.repository as never, mock.runInTransaction as never); await assert.rejects(() => service.enrich({ leadId: 'lead-1', companyName: 'Example Business', officialWebsiteUrl: 'https://example.co.za/', supportingResults: [{ title: 'Example', url: 'https://example.co.za/', content: 'Example.' }] }), /requires an explicit requeue/); assert.equal(mock.enrichments.length, 0); });
test('accepts Randburg Coin Compony concatenated domain', async () => {
  const mock = mockRepository('pending', 'Randburg Coin Compony');
  const service = createLeadPublicWebEnrichmentService(mock.repository as never, mock.runInTransaction as never);

  const result = await service.enrich({
    leadId: 'lead-1',
    companyName: 'Randburg Coin Compony',
    officialWebsiteUrl: 'https://randburgcoin.co.za/',
    supportingResults: [{
      title: 'Randburg Coin Compony | Home',
      url: 'https://randburgcoin.co.za/',
      content: 'Randburg Coin Compony provides manufacturing services in Randburg.',
    }],
  });

  assert.equal(result.enrichmentStatus, 'verified');
});

test('accepts Michael Vaughan concatenated domain', async () => {
  const mock = mockRepository('pending', 'Michael Vaughan Construction Management & Consulting');
  const service = createLeadPublicWebEnrichmentService(mock.repository as never, mock.runInTransaction as never);

  const result = await service.enrich({
    leadId: 'lead-1',
    companyName: 'Michael Vaughan Construction Management & Consulting',
    officialWebsiteUrl: 'https://michaelvaughan.co.za/',
    supportingResults: [{
      title: 'Michael Vaughan Construction Management & Consulting',
      url: 'https://michaelvaughan.co.za/',
      content: 'Michael Vaughan provides construction management and consulting services.',
    }],
  });

  assert.equal(result.enrichmentStatus, 'verified');
});

test('accepts Pro Contracts concatenated domain', async () => {
  const mock = mockRepository('pending', 'Pro Contracts (Pty) Ltd');
  const service = createLeadPublicWebEnrichmentService(mock.repository as never, mock.runInTransaction as never);

  const result = await service.enrich({
    leadId: 'lead-1',
    companyName: 'Pro Contracts (Pty) Ltd',
    officialWebsiteUrl: 'https://procontracts.co.za/',
    supportingResults: [{
      title: 'Pro Contracts',
      url: 'https://procontracts.co.za/',
      content: 'Pro Contracts provides professional contracting services.',
    }],
  });

  assert.equal(result.enrichmentStatus, 'verified');
});

test('accepts DSES Project Solutions concatenated domain', async () => {
  const mock = mockRepository('pending', 'DSES Project Solutions');
  const service = createLeadPublicWebEnrichmentService(mock.repository as never, mock.runInTransaction as never);

  const result = await service.enrich({
    leadId: 'lead-1',
    companyName: 'DSES Project Solutions',
    officialWebsiteUrl: 'https://dsesprojects.co.za/',
    supportingResults: [{
      title: 'DSES Project Solutions',
      url: 'https://dsesprojects.co.za/',
      content: 'DSES Project Solutions provides project solutions.',
    }],
  });

  assert.equal(result.enrichmentStatus, 'verified');
});

test('accepts KMG abbreviated domain when construction is a non-identity token', async () => {
  const mock = mockRepository('pending', 'KMG Construction');
  const service = createLeadPublicWebEnrichmentService(mock.repository as never, mock.runInTransaction as never);

  const result = await service.enrich({
    leadId: 'lead-1',
    companyName: 'KMG Construction',
    officialWebsiteUrl: 'https://kmg.co.za/',
    supportingResults: [{
      title: 'KMG Construction',
      url: 'https://kmg.co.za/',
      content: 'KMG Construction provides construction services.',
    }],
  });

  assert.equal(result.enrichmentStatus, 'verified');
});

test('rejects a domain matching only a generic construction token', async () => {
  const mock = mockRepository('pending', 'Randburg Coin Compony');
  const service = createLeadPublicWebEnrichmentService(mock.repository as never, mock.runInTransaction as never);

  const result = await service.enrich({
    leadId: 'lead-1',
    companyName: 'Randburg Coin Compony',
    officialWebsiteUrl: 'https://construction.co.za/',
    supportingResults: [{
      title: 'Construction Services',
      url: 'https://construction.co.za/',
      content: 'Construction services and contractors.',
    }],
  });

  assert.equal(result.enrichmentStatus, 'not_found');
  assert.equal(mock.enrichments[0]?.input.officialWebsiteUrl, undefined);
});

test('rejects Kwali Group Construction against unrelated abbreviation domain', async () => {
  const mock = mockRepository('pending', 'Kwali Group Construction');
  const service = createLeadPublicWebEnrichmentService(mock.repository as never, mock.runInTransaction as never);

  const result = await service.enrich({
    leadId: 'lead-1',
    companyName: 'Kwali Group Construction',
    officialWebsiteUrl: 'https://kgc.co.za/',
    supportingResults: [{
      title: 'KGC Construction',
      url: 'https://kgc.co.za/',
      content: 'A construction company operating in South Africa.',
    }],
  });

  assert.equal(result.enrichmentStatus, 'not_found');
  assert.equal(mock.enrichments[0]?.input.officialWebsiteUrl, undefined);
});
