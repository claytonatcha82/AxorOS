import assert from 'node:assert/strict';
import test from 'node:test';
import { selectOfficialWebsite } from './lead-official-website-selector.js';

test('fails closed when an unrelated domain repeats a multi-word business identity', () => {
  const result = selectOfficialWebsite({
    businessName: 'Abrams Renovation and Residential Building Project',
    results: [{
      title: 'Abrams Renovation and Residential Building Project',
      url: 'https://wanderboat.ai/',
      content: 'Abrams Renovation and Residential Building Project. Business information and company details.',
    }],
  });

  assert.equal(result.status, 'not_found');
});
