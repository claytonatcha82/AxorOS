import assert from 'node:assert/strict';
import test from 'node:test';
import { SUPPORT_AGENT_CHARTER, supportActionAuthority } from './support-agent-charter.js';

test('support agent owns client success and maintenance after launch', () => {
  assert.equal(SUPPORT_AGENT_CHARTER.role, 'AI Client Success and Maintenance Agent');
  assert.equal(supportActionAuthority('monitor_website'), 'allowed');
  assert.equal(supportActionAuthority('update_support_ticket'), 'allowed');
});

test('dangerous production actions require approval', () => {
  assert.equal(supportActionAuthority('production_code_change'), 'approval_required');
  assert.equal(supportActionAuthority('deployment'), 'approval_required');
  assert.equal(supportActionAuthority('rollback'), 'approval_required');
  assert.equal(supportActionAuthority('client_credential_change'), 'approval_required');
});

test('support cannot alter commercial or sensitive financial authority', () => {
  assert.equal(supportActionAuthority('banking_access'), 'prohibited');
  assert.equal(supportActionAuthority('modify_pricing'), 'prohibited');
  assert.equal(supportActionAuthority('execute_refund'), 'prohibited');
  assert.equal(supportActionAuthority('modify_contract'), 'prohibited');
});
