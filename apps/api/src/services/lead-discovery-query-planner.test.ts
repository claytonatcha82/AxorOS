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
  assert.deepEqual(result.exhaustedQueries, []);
  assert.equal(result.geographicVariantUsed, 'South Africa');
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

test('interleaves query variants per industry', () => {
  const planner = createLeadDiscoveryQueryPlanner();
  const result = planner.plan({
    industries: ['Construction', 'Engineering', 'Civil engineering', 'Manufacturing'],
    geographicFocus: 'South Africa',
    maxQueries: 6,
  });

  assert.deepEqual(result.queries, [
    'Construction businesses in South Africa',
    'Construction companies in South Africa',
    'professional Construction firms in South Africa',
    'Engineering businesses in South Africa',
    'Engineering companies in South Africa',
    'professional Engineering firms in South Africa',
  ]);
});

test('skips exhausted queries and reports which ones were skipped', () => {
  const planner = createLeadDiscoveryQueryPlanner();
  const result = planner.plan({
    industries: ['Construction', 'Engineering'],
    geographicFocus: 'South Africa',
    maxQueries: 6,
    exhaustedQueries: [
      'Construction businesses in South Africa',
      'Construction companies in South Africa',
    ],
  });

  assert.deepEqual(result.queries, [
    'professional Construction firms in South Africa',
    'Engineering businesses in South Africa',
    'Engineering companies in South Africa',
    'professional Engineering firms in South Africa',
  ]);
  assert.deepEqual(result.exhaustedQueries, [
    'Construction businesses in South Africa',
    'Construction companies in South Africa',
  ]);
});

test('uses configured geographic sub-regions while keeping the primary region first', () => {
  const planner = createLeadDiscoveryQueryPlanner();
  const result = planner.plan({
    industries: ['Construction'],
    geographicFocus: 'South Africa',
    geographicVariants: ['Gauteng', 'Western Cape', 'Durban'],
    maxQueries: 6,
    exhaustedQueries: [
      'Construction businesses in South Africa',
      'Construction companies in South Africa',
      'professional Construction firms in South Africa',
    ],
  });

  assert.deepEqual(result.queries, [
    'Construction businesses in Gauteng',
    'Construction businesses in Western Cape',
    'Construction businesses in Durban',
    'Construction companies in Gauteng',
    'Construction companies in Western Cape',
    'Construction companies in Durban',
  ]);
  assert.equal(result.geographicVariantUsed, 'Gauteng');
});

test('does not duplicate the primary geographic focus when it is also configured as a variant', () => {
  const planner = createLeadDiscoveryQueryPlanner();
  const result = planner.plan({
    industries: ['Construction'],
    geographicFocus: 'South Africa',
    geographicVariants: ['South Africa', 'Gauteng'],
    maxQueries: 12,
  });

  assert.deepEqual(result.queries, [
    'Construction businesses in South Africa',
    'Construction businesses in Gauteng',
    'Construction companies in South Africa',
    'Construction companies in Gauteng',
    'professional Construction firms in South Africa',
    'professional Construction firms in Gauteng',
  ]);
});
