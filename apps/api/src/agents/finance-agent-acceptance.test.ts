import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateFinanceAcceptanceSuite, FINANCE_AGENT_ACCEPTANCE_CASES } from './finance-agent-acceptance.js';

test('finance suite contains all twelve architecture scenarios', () => {
  assert.equal(FINANCE_AGENT_ACCEPTANCE_CASES.length, 12);
  assert.deepEqual(FINANCE_AGENT_ACCEPTANCE_CASES.map(([id]) => id), ['deposit_success','client_claim_no_confirmation','duplicate_webhook','invoice_proposal_mismatch','partial_payment','refund_request','provider_failure','change_request','foreign_currency','unprofitable_ai_spend','subscription_failure','manual_payment']);
});

test('finance foundation passes only when every scenario is passed and verified', () => {
  const results = FINANCE_AGENT_ACCEPTANCE_CASES.map(([id]) => ({ caseId: id, passed: true, verified: true }));
  assert.deepEqual(evaluateFinanceAcceptanceSuite(results), { passing: true, failedCases: [] });
  results[1]!.verified = false;
  assert.deepEqual(evaluateFinanceAcceptanceSuite(results), { passing: false, failedCases: ['client_claim_no_confirmation'] });
});
