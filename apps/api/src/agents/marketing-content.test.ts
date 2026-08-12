import assert from 'node:assert/strict';
import test from 'node:test';
import { marketingClaimMayPublish, validateMarketingContentPlan } from './marketing-content.js';

test('content requires a business objective audience pillar knowledge and success metric', () => {
  assert.deepEqual(validateMarketingContentPlan({ contentId: 'm1', businessGoal: 'increase engineering inbound leads', targetAudience: 'engineering firms', category: 'educational', topic: 'What engineering websites need to build trust', pillars: ['education', 'trust'], knowledgeReferences: ['atlas://positioning', 'atlas://engineering'], channel: 'linkedin', successMetric: 'qualified inbound leads' }), []);
});

test('random posting without an objective or pillar is rejected', () => {
  const errors = validateMarketingContentPlan({ contentId: 'm2', businessGoal: '', targetAudience: 'businesses', category: 'industry_insight', topic: 'random trend', pillars: [], knowledgeReferences: [], channel: 'linkedin', successMetric: '' });
  assert.ok(errors.includes('businessGoal is required.'));
  assert.ok(errors.includes('at least one marketing pillar is required.'));
  assert.ok(errors.includes('knowledgeReferences are required.'));
});

test('case study and result claims require evidence', () => {
  assert.equal(marketingClaimMayPublish({ statement: 'Client conversions increased by 40%.', evidenceReferences: [], isResultClaim: true }), false);
  assert.equal(marketingClaimMayPublish({ statement: 'Client conversions increased by 40%.', evidenceReferences: ['project://metrics/1'], isResultClaim: true }), true);
});
