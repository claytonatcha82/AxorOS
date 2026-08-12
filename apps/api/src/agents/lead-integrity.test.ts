import assert from 'node:assert/strict';
import test from 'node:test';
import { isDuplicateLead, leadFreshnessStatus, researchedFieldIsSupported } from './lead-integrity.js';

test('duplicate lead detection catches matching website domains before CRM creation', () => {
  assert.equal(isDuplicateLead({ companyName: 'Example Engineering', websiteDomain: 'www.example.co.za', country: 'South Africa' }, [{ leadId: 'lead-1', companyName: 'Example Engineering Pty Ltd', websiteDomain: 'example.co.za', country: 'South Africa' }]), true);
});

test('same company name in different countries is not automatically a duplicate without matching domains', () => {
  assert.equal(isDuplicateLead({ companyName: 'Acme', country: 'South Africa' }, [{ companyName: 'Acme', country: 'United Kingdom' }]), false);
});

test('closure evidence prevents stale businesses from being treated as active leads', () => {
  assert.equal(leadFreshnessStatus({ checkedAt: '2026-08-12', closureEvidence: true, activeWebsite: false }), 'closed');
  assert.equal(leadFreshnessStatus({ checkedAt: '2026-08-12', activeBusinessListing: true }), 'active');
});

test('known researched values require source evidence while unknown may remain unknown', () => {
  assert.equal(researchedFieldIsSupported({ value: '50 employees', sourceUrl: 'https://example.com/about' }), true);
  assert.equal(researchedFieldIsSupported({ value: '50 employees' }), false);
  assert.equal(researchedFieldIsSupported({}), true);
});
