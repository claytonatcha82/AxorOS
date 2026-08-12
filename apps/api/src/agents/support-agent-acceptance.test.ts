import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateSupportAcceptanceSuite, SUPPORT_AGENT_ACCEPTANCE_CASES } from './support-agent-acceptance.js';

test('support acceptance suite contains all eight charter scenarios', () => {
  assert.deepEqual(SUPPORT_AGENT_ACCEPTANCE_CASES.map((item) => item.id), ['site_down', 'text_update', 'new_booking_system', 'expired_ssl', 'security_compromise', 'recurring_form_failure', 'expired_support_contract', 'repeated_booking_requests']);
});

test('support foundation passes only when every acceptance scenario is passed and verified', () => {
  const results = SUPPORT_AGENT_ACCEPTANCE_CASES.map((item) => ({ caseId: item.id, passed: true, verified: true }));
  assert.deepEqual(evaluateSupportAcceptanceSuite(results), { passing: true, failedCases: [] });
  results[4]!.verified = false;
  assert.deepEqual(evaluateSupportAcceptanceSuite(results), { passing: false, failedCases: ['security_compromise'] });
});
