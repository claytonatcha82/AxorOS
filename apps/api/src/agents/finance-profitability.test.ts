import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateProjectFinancialSummary, validateAiCostEvent } from './finance-profitability.js';

test('project profitability is calculated deterministically from actual financial records', () => {
  const summary = calculateProjectFinancialSummary({ projectId: 'p1', contractValueMinor: 1000000, approvedChangeRequestsMinor: 0, totalRevenueMinor: 1000000, paymentProcessingFeesMinor: 20000, aiCostsMinor: 30000, hostingCostsMinor: 10000, softwareCostsMinor: 15000, contractorCostsMinor: 100000, otherDirectCostsMinor: 25000, outstandingReceivablesMinor: 0, refundsMinor: 0 });
  assert.equal(summary.totalDirectCostMinor, 200000);
  assert.equal(summary.grossProfitMinor, 800000);
  assert.equal(summary.grossMargin, 0.8);
});

test('refunds reduce revenue used in gross-margin calculation', () => {
  const summary = calculateProjectFinancialSummary({ projectId: 'p2', contractValueMinor: 1000000, approvedChangeRequestsMinor: 0, totalRevenueMinor: 1000000, paymentProcessingFeesMinor: 0, aiCostsMinor: 100000, hostingCostsMinor: 0, softwareCostsMinor: 0, contractorCostsMinor: 0, otherDirectCostsMinor: 0, outstandingReceivablesMinor: 0, refundsMinor: 200000 });
  assert.equal(summary.grossProfitMinor, 700000);
  assert.equal(summary.grossMargin, 0.875);
});

test('AI cost events require attributable deterministic usage data', () => {
  assert.deepEqual(validateAiCostEvent({ provider: 'openai', model: 'model-x', agentId: 'production_agent', projectId: 'p1', clientId: 'c1', tokensInput: 1000, tokensOutput: 500, providerCostMinor: 250, currency: 'ZAR', recordedAt: '2026-08-12T00:00:00Z' }), []);
  assert.ok(validateAiCostEvent({ provider: '', model: '', agentId: '', tokensInput: -1, tokensOutput: 0, providerCostMinor: -1, currency: '', recordedAt: '2026-08-12T00:00:00Z' }).length > 0);
});
