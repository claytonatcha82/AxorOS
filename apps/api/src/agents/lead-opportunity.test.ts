import assert from 'node:assert/strict';
import test from 'node:test';
import { recommendLeadServices, scoreLeadOpportunity } from './lead-opportunity.js';

test('weighted lead scoring produces a bounded 0 to 100 opportunity score', () => {
  assert.equal(scoreLeadOpportunity({ websiteQualityOpportunity: 1, businessMaturity: 1, industryFit: 1, growthIndicators: 1, budgetLikelihood: 1, seoOpportunity: 1, aiAutomationOpportunity: 1 }), 100);
  assert.equal(scoreLeadOpportunity({ websiteQualityOpportunity: 0, businessMaturity: 0, industryFit: 0, growthIndicators: 0, budgetLikelihood: 0, seoOpportunity: 0, aiAutomationOpportunity: 0 }), 0);
});

test('business without a website is recommended website services', () => {
  assert.deepEqual(recommendLeadServices({ hasWebsite: false, designQuality: 'unknown', mobileFriendly: 'unknown', https: 'unknown', performance: 'unknown', seoQuality: 'unknown', accessibilityQuality: 'unknown', conversionQuality: 'unknown' }), ['website_design_and_development']);
});

test('strong website with poor SEO receives SEO recommendation rather than rebuild', () => {
  const services = recommendLeadServices({ hasWebsite: true, designQuality: 'strong', mobileFriendly: true, https: true, performance: 'strong', seoQuality: 'poor', accessibilityQuality: 'strong', conversionQuality: 'strong' });
  assert.deepEqual(services, ['seo_optimisation']);
  assert.equal(services.includes('website_redesign'), false);
});

test('multiple website weaknesses justify redesign', () => {
  const services = recommendLeadServices({ hasWebsite: true, designQuality: 'poor', mobileFriendly: false, https: true, performance: 'poor', seoQuality: 'poor', accessibilityQuality: 'adequate', conversionQuality: 'poor' });
  assert.ok(services.includes('website_redesign'));
  assert.ok(services.includes('seo_optimisation'));
});
