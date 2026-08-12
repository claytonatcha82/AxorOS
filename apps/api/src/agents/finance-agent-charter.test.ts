import assert from 'node:assert/strict';
import test from 'node:test';
import { financeActionAuthority, FINANCE_AGENT_CHARTER, paymentMayBeConfirmed } from './finance-agent-charter.js';

test('finance is financial state controller rather than bank operator', () => {
  assert.equal(FINANCE_AGENT_CHARTER.role, 'AI Finance Operations Agent');
  assert.equal(financeActionAuthority('banking_credentials_access'), 'prohibited');
  assert.equal(financeActionAuthority('money_transfer'), 'prohibited');
  assert.equal(financeActionAuthority('refund_execution'), 'approval_required');
  assert.equal(financeActionAuthority('calculate_balance'), 'allowed');
});

test('client claim alone never confirms payment', () => {
  assert.equal(paymentMayBeConfirmed({ providerVerified: false, clientClaimsPaid: true }), false);
  assert.equal(paymentMayBeConfirmed({ providerVerified: true, clientClaimsPaid: false }), true);
});
