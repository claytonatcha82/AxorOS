import assert from 'node:assert/strict';
import test from 'node:test';
import { assertQualifiedSalesLeadReady, validateQualifiedSalesLeadPackage, type QualifiedSalesLeadPackage } from './sales-lead-contract.js';

function validLead(): QualifiedSalesLeadPackage {
  return {
    leadId: 'lead-001',
    company: 'Example Civils',
    decisionMaker: 'Jane Doe',
    industry: 'Construction',
    country: 'South Africa',
    businessSummary: 'Civil engineering contractor serving commercial clients.',
    websiteAudit: 'Website is dated and difficult to use on mobile.',
    painPoints: ['Poor mobile usability'],
    recommendedServices: ['Website redesign'],
    leadScore: 82,
    priority: 'high',
    confidence: 0.86,
    previousContact: 'none',
    knowledgeReferences: ['atlas://sales/website-redesign'],
  };
}

test('complete qualified lead package is accepted', () => {
  const validation = validateQualifiedSalesLeadPackage(validLead());
  assert.equal(validation.valid, true);
  assert.deepEqual(validation.missingFields, []);
  assert.deepEqual(validation.errors, []);
  assert.doesNotThrow(() => assertQualifiedSalesLeadReady(validLead()));
});

test('sales lead package blocks incomplete research context', () => {
  const lead = validLead();
  lead.businessSummary = '';
  lead.websiteAudit = '';
  lead.recommendedServices = [];

  const validation = validateQualifiedSalesLeadPackage(lead);
  assert.equal(validation.valid, false);
  assert.ok(validation.missingFields.includes('businessSummary'));
  assert.ok(validation.missingFields.includes('websiteAudit'));
  assert.ok(validation.missingFields.includes('recommendedServices'));
});

test('sales lead package enforces bounded scoring and confidence', () => {
  const lead = validLead();
  lead.leadScore = 120;
  lead.confidence = 1.5;

  const validation = validateQualifiedSalesLeadPackage(lead);
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.includes('leadScore must be between 0 and 100.'));
  assert.ok(validation.errors.includes('confidence must be between 0 and 1.'));
});
