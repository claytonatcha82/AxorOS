import assert from 'node:assert/strict';
import test from 'node:test';
import { createLeadDiscoveryQueryPlanner } from './lead-discovery-query-planner.js';

test('expands an Atlas industry into bounded distinct discovery queries', () => {
  const planner = createLeadDiscoveryQueryPlanner();
  const result = planner.plan({
    industries: ['Construction'],
    geographicFocus: 'South Africa',
    maxQueries: 12,
  });

  assert.deepEqual(result.queries, [
    'Construction businesses in South Africa',
    'Construction companies in South Africa',
    'professional Construction firms in South Africa',
  ]);
});

test('deduplicates industries and respects the query cap', () => {
  const planner = createLeadDiscoveryQueryPlanner();
  const result = planner.plan({
    industries: ['Construction', 'Construction'],
    geographicFocus: 'South Africa',
    maxQueries: 2,
  });

  assert.deepEqual(result.queries, [
    'Construction businesses in South Africa',
    'Construction companies in South Africa',
  ]);
});

test('interleaves Atlas industries before repeating query variants', () => {
  const planner = createLeadDiscoveryQueryPlanner();
  const result = planner.plan({
    industries: ['Construction', 'Engineering', 'Civil engineering', 'Manufacturing'],
    geographicFocus: 'South Africa',
    maxQueries: 6,
  });

  assert.deepEqual(result.queries, [
    'Construction businesses in South Africa',
    'Engineering businesses in South Africa',
    'Civil engineering businesses in South Africa',
    'Manufacturing businesses in South Africa',
    'Construction companies in South Africa',
    'Engineering companies in South Africa',
  ]);
});
