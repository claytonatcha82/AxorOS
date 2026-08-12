import assert from 'node:assert/strict';
import test from 'node:test';
import { leadRevenueEfficiency, validateLeadAgentKpis } from './lead-kpis.js';

test('lead KPIs validate revenue-focused qualification performance', () => {
  const kpis = {
    qualifiedLeadsGenerated: 15, qualificationAccuracy: 0.94, duplicateRate: 0.01, averageLeadScore: 84,
    salesConversionRate: 4 / 15, revenueFromSourcedLeads: 120000, averageQualificationTimeMs: 90000, researchCostPerLead: 2.5,
  };
  assert.deepEqual(validateLeadAgentKpis(kpis), []);
  assert.equal(leadRevenueEfficiency(kpis), 8000);
});

test('invalid rates scores and negative cost values are rejected', () => {
  const errors = validateLeadAgentKpis({
    qualifiedLeadsGenerated: -1, qualificationAccuracy: 1.2, duplicateRate: -0.1, averageLeadScore: 101,
    salesConversionRate: 2, revenueFromSourcedLeads: -1, averageQualificationTimeMs: -1, researchCostPerLead: -1,
  });
  assert.ok(errors.length >= 7);
});
