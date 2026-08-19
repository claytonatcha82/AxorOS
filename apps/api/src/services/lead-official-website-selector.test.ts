import assert from 'node:assert/strict';
import test from 'node:test';
import { selectOfficialWebsite } from './lead-official-website-selector.js';

test('selects a strong first-party website candidate', () => {
  const result = selectOfficialWebsite({ businessName: 'Acme Engineering', results: [
    { title: 'Acme Engineering | Industrial Solutions', url: 'https://acmeengineering.co.za/services', content: 'Industrial engineering services.' },
    { title: 'Acme Engineering on Facebook', url: 'https://facebook.com/acmeengineering', content: 'Social profile.' },
  ] });
  assert.equal(result.status, 'selected');
  if (result.status === 'selected') assert.equal(result.websiteUrl, 'https://acmeengineering.co.za/');
});

test('fails closed when competing domains have equal identity evidence', () => {
  const result = selectOfficialWebsite({ businessName: 'Acme Engineering', results: [
    { title: 'Acme Engineering', url: 'https://acmeengineering.co.za/', content: 'Candidate.' },
    { title: 'Acme Engineering', url: 'https://acme-engineering.com/', content: 'Candidate.' },
  ] });
  assert.equal(result.status, 'ambiguous');
});

test('rejects social and directory results as official websites', () => {
  const result = selectOfficialWebsite({ businessName: 'Acme Engineering', results: [
    { title: 'Acme Engineering', url: 'https://www.facebook.com/acmeengineering', content: 'Social.' },
    { title: 'Acme Engineering', url: 'https://www.linkedin.com/company/acme-engineering', content: 'Profile.' },
  ] });
  assert.equal(result.status, 'not_found');
});
