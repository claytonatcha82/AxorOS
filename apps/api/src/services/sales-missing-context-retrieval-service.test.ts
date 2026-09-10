import test from 'node:test';
import assert from 'node:assert/strict';
import type { LeadRecord } from '../data/operational-repository.js';
import { createSalesMissingContextRetrievalService } from './sales-missing-context-retrieval-service.js';

const lead: LeadRecord = {
  id: 'lead-1',
  clientId: null,
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
  createdAt: '2026-09-07T00:00:00.000Z',
  updatedAt: '2026-09-07T00:00:00.000Z',
};

function registryWithResults(resultsByQuery: Record<string, Array<{ title: string; url: string; content: string }>>) {
  return {
    async execute(request: { input: { query: string } }) {
      const key = Object.keys(resultsByQuery).find((candidate) => request.input.query.includes(candidate));
      return { status: 'succeeded', output: { results: key ? resultsByQuery[key] : [] } };
    },
  } as never;
}

test('retrieves explicitly missing Sales context and performs targeted decision-maker research', async () => {
  const service = createSalesMissingContextRetrievalService(registryWithResults({
    'industry sector': [{ title: 'Proman profile', url: 'https://www.promanconstruction.co.za/about', content: 'Construction management company.' }],
    'managing director': [{ title: 'Proman leadership', url: 'https://www.promanconstruction.co.za/team', content: 'Managing Director Donovan Proudfoot.' }],
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
  assert.equal(result.searchesRun, 4);
  assert.equal(result.searchesFailed, 0);
  assert.deepEqual(result.providerFailures, []);
  assert.equal(result.evidence.length, 2);
  assert.ok(result.evidence.some((item) => item.content.includes('Donovan Proudfoot')));
  assert.equal(result.nextAction, 'reassess_sales_context');
});

test('records provider failures instead of disguising them as zero searches', async () => {
  const service = createSalesMissingContextRetrievalService({
    async execute() {
      return {
        status: 'failed',
        output: {
          query: 'test',
          results: [],
          providerErrorCode: 'HTTP_429',
          providerErrorMessage: 'rate limit exceeded',
        },
      };
    },
  } as never);

  const result = await service.retrieve({
    lead,
    missingFields: ['decision_maker'],
    executionId: 'sales-followthrough:failure',
    correlationId: 'corr-failure',
  });

  assert.equal(result.searchesRun, 0);
  assert.equal(result.searchesFailed, 3);
  assert.equal(result.evidence.length, 0);
  assert.deepEqual(result.providerFailures, [
    {
      query: '"Proman Construction Managers" company profile services projects contact leadership',
      code: 'HTTP_429',
      message: 'rate limit exceeded',
    },
    {
      query: '"Proman Construction Managers" "managing director" director founder owner CEO leadership team',
      code: 'HTTP_429',
      message: 'rate limit exceeded',
    },
    {
      query: '"Proman Construction Managers" "managing director" director founder owner CEO leadership LinkedIn',
      code: 'HTTP_429',
      message: 'rate limit exceeded',
    },
  ]);
});

test('deduplicates evidence by URL', async () => {
  const service = createSalesMissingContextRetrievalService(registryWithResults({
    'industry sector': [{ title: 'A', url: 'https://example.com/a', content: 'A' }],
    'about services capabilities projects company': [{ title: 'A duplicate', url: 'https://example.com/a', content: 'A duplicate' }],
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
  assert.equal(result.searchesFailed, 0);
  assert.deepEqual(result.providerFailures, []);
  assert.deepEqual(result.evidence, []);
});
