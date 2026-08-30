import assert from 'node:assert/strict';
import test from 'node:test';
import { EMAIL_IDENTITIES, assertAgentMayUseEmailIdentity, getEmailIdentity } from './email-identity-policy.js';

test('registers distinct external identities for approved specialist agents', () => {
  assert.equal(EMAIL_IDENTITIES.length, 5);
  assert.equal(getEmailIdentity('sales')?.displayName, 'AxorOS Sales Team');
  assert.equal(getEmailIdentity('support')?.displayName, 'AxorOS Support Team');
  assert.equal(getEmailIdentity('finance')?.displayName, 'AxorOS Finance Team');
});

test('allows Sales Agent to use only the sales identity', () => {
  assert.equal(assertAgentMayUseEmailIdentity('sales_agent', 'sales').identityId, 'sales');
  assert.throws(
    () => assertAgentMayUseEmailIdentity('sales_agent', 'finance'),
    /may not use email identity finance/,
  );
});

test('does not give Lead Agent an external sender identity', () => {
  assert.throws(
    () => assertAgentMayUseEmailIdentity('lead_agent', 'sales'),
    /may not use email identity sales/,
  );
});

test('rejects unregistered sender identities', () => {
  assert.throws(
    () => assertAgentMayUseEmailIdentity('sales_agent', 'ceo'),
    /email identity is not registered/,
  );
});
