import assert from 'node:assert/strict';
import test from 'node:test';
import { aiCostPercentageOfRevenue, financeExecutionRoute } from './finance-reporting.js';

test('finance routes deterministic work away from LLMs', () => {
  assert.equal(financeExecutionRoute('invoice_status'), 'deterministic_query');
  assert.equal(financeExecutionRoute('payment_confirmation'), 'provider_verification');
  assert.equal(financeExecutionRoute('balance_calculation'), 'deterministic_code');
  assert.equal(financeExecutionRoute('routine_reminder'), 'small_language_model');
  assert.equal(financeExecutionRoute('complex_dispute_summary'), 'strong_reasoning');
  assert.equal(financeExecutionRoute('financial_strategy'), 'executive_human_review');
});

test('AI cost percentage is deterministic and does not invent a ratio without revenue', () => {
  assert.equal(aiCostPercentageOfRevenue(5000, 100000), 5);
  assert.equal(aiCostPercentageOfRevenue(5000, 0), null);
});
