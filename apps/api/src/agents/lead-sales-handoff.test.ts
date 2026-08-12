import assert from 'node:assert/strict';
import test from 'node:test';
import { validateQualifiedLeadSalesHandoff } from './lead-sales-handoff.js';

test('complete qualified lead handoff is accepted', () => {
  assert.deepEqual(validateQualifiedLeadSalesHandoff({
    leadId: 'lead-001', company: 'Example Engineering', industry: 'Engineering', location: 'Durban, South Africa', website: 'https://example.co.za',
    auditSummary: 'Outdated site with weak mobile performance and poor SEO.', businessSummary: 'Established engineering services company.',
    recommendedServices: ['website_redesign', 'seo_optimisation'], estimatedBudget: 'unknown', painPoints: ['Poor mobile experience', 'Weak search visibility'],
    leadScore: 91, confidence: 0.92, knowledgeReferences: ['ICP', 'Sales Qualification SOP'], recommendedSalesStrategy: 'Lead with mobile and SEO opportunity evidence.',
  }), []);
});

test('sales handoff rejects weak or incomplete opportunity packages', () => {
  const errors = validateQualifiedLeadSalesHandoff({
    leadId: '', company: '', industry: '', location: '', auditSummary: '', businessSummary: '', recommendedServices: [], painPoints: [],
    leadScore: 120, confidence: 2, knowledgeReferences: [], recommendedSalesStrategy: '',
  });
  assert.ok(errors.includes('leadId is required.'));
  assert.ok(errors.includes('at least one recommended service is required.'));
  assert.ok(errors.includes('leadScore must be between 0 and 100.'));
});
