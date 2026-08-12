import assert from 'node:assert/strict';
import test from 'node:test';
import { marketingModelTier, primaryMarketingOutcome, validateMarketingKpis } from './marketing-analytics.js';

const valid = { organicTraffic: 1000, qualifiedInboundLeads: 20, contentProduction: 8, keywordGrowth: 12, domainAuthorityTrend: 2, emailOpenRate: 0.4, clickThroughRate: 0.08, portfolioViews: 200, conversionRate: 0.05, costPerInboundLead: 10, marketingAttributedRevenue: 5000 };

test('marketing KPIs remain grounded in qualified demand and revenue', () => {
  assert.deepEqual(validateMarketingKpis(valid), []);
  assert.equal(primaryMarketingOutcome(valid), 5000);
});

test('marketing does not use premium reasoning for repetitive drafting and analytics', () => {
  assert.equal(marketingModelTier('planning'), 'strong_reasoning');
  assert.equal(marketingModelTier('drafting'), 'efficient_language');
  assert.equal(marketingModelTier('seo_analysis'), 'deterministic_plus_ai');
  assert.equal(marketingModelTier('analytics'), 'rules_lightweight_ai');
});
