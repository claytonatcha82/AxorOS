import assert from 'node:assert/strict';
import test from 'node:test';
import { executiveMayDirectlyExecute, executiveShouldDelegateToOperations, validateExecutiveOperationsInstruction } from './executive-delegation.js';

test('executive creates complete operations instructions', () => {
  assert.deepEqual(validateExecutiveOperationsInstruction({
    instructionId: 'exec-001', task: 'Prioritise three proposal-stage opportunities', priority: 'high',
    assignedFunction: 'sales', rationale: 'Highest near-term revenue impact', expectedOutcome: 'Advance qualified opportunities toward decision',
  }), []);
});

test('executive cannot directly execute specialist work', () => {
  for (const action of ['find_leads', 'send_sales_email', 'build_website', 'manage_support_ticket', 'post_marketing_content', 'process_payment', 'deploy_code']) {
    assert.equal(executiveMayDirectlyExecute(action), false);
  }
  assert.equal(executiveMayDirectlyExecute('rank_priorities'), true);
});

test('specialist-direction flows through operations rather than bypassing coordination', () => {
  assert.equal(executiveShouldDelegateToOperations('sales'), true);
  assert.equal(executiveShouldDelegateToOperations('production'), true);
  assert.equal(executiveShouldDelegateToOperations('operations'), false);
});
