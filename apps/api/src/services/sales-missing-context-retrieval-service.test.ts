import test from 'node:test';
import assert from 'node:assert/strict';
import type { LeadRecord } from '../data/operational-repository.js';
import { createSalesMissingContextRetrievalService } from './sales-missing-context-retrieval-service.js';

const lead: LeadRecord = {
  id: 'lead-1',
  companyName: 'Proman Construction Managers',
  contactName: null,
  contactEmail: 'donovan@promanconstruction.co.za',
  source: 'google_places',
  opportunitySummary: 'Official website independently identified: https://www.promanconstruction.co.za/',
  leadScore: 49,
  status: 'new',
  enrichmentStatus: 'verified',
  evidence: [
    { kind: 'public_web_enrichment', officialWebsiteUrl: 'https://www.promanconstruction.co.za/' },
  ],
};

function registryWithResults(resultsByQuery: Record<string, Array<{ title: string; url: string; content: string }>>) {
  return {
    async execute(request: { input: { query: string } }) {
      const key = Object.keys(resultsByQuery).find((candidate) => request.input.query.includes(candidate));
      return { status: 'succeeded', output: { results: key ? resultsByQuery[key] : [] } };
    },
  } as never;
}

test('retrieves only explicitly missing Sales context fields', async () => {
  const service = createSalesMissingContextRetrievalService(registryWithResults({
    'industry business': [{ title: 'Proman profile', url: 'https://www.promanconstruction.co.za/about', content: 'Construction management company.' }],
    'directors owners': [{ title: 'Proman leadership', url: 'https://www.promanconstruction.co.za/team', content: 'Managing Director Donovan.' }],
  }));

  const result = await service.retrieve({
    lead,
    missingFields: ['industry', 'decision_maker'],
    executionId: 'sales-followthrough:1',
    correlationId: 'corr-1',
    country: 'South Africa',
  });

  assert.equal(result.leadId, 'lead-1');
  assert.deepEqual(result.missingFields, ['industry', 'decision_maker']);
  assert.equal(result.searchesRun, 2);
  assert.equal(result.evidence.length, 2);
  assert.equal(result.nextAction, 'reassess_sales_context');
});

test('deduplicates evidence by URL', async () => {
  const service = createSalesMissingContextRetrievalService(registryWithResults({
    'industry business': [{ title: 'A', url: 'https://example.com/a', content: 'A' }],
    'business services': [{ title: 'A duplicate', url: 'https://example.com/a', content: 'A duplicate' }],
  }));

  const result = await service.retrieve({
    lead,
    missingFields: ['industry', 'business_summary'],
    executionId: 'sales-followthrough:2',
    correlationId: 'corr-2',
  });

  assert.equal(result.evidence.length, 1);
});

test('ignores unknown fields instead of inventing a query', async () => {
  const service = createSalesMissingContextRetrievalService(registryWithResults({}));
  const result = await service.retrieve({
    lead,
    missingFields: ['unsupported_field'],
    executionId: 'sales-followthrough:3',
    correlationId: 'corr-3',
  });

  assert.equal(result.searchesRun, 0);
  assert.deepEqual(result.evidence, []);
});
