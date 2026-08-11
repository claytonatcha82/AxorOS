import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SALES_AGENT_AUTONOMY,
  SALES_AGENT_PERMISSIONS,
  salesAgentIsProhibited,
} from './sales-agent-policy.js';

test('sales agent begins in draft mode with bounded permissions', () => {
  assert.equal(SALES_AGENT_AUTONOMY, 'draft_mode');
  assert.equal(SALES_AGENT_PERMISSIONS.atlasOs, 'read');
  assert.equal(SALES_AGENT_PERMISSIONS.crm, 'read_update');
  assert.equal(SALES_AGENT_PERMISSIONS.email, 'draft');
  assert.equal(SALES_AGENT_PERMISSIONS.proposalSystem, 'create_draft');
});

test('sales agent explicitly blocks high-risk commercial and operational actions', () => {
  assert.equal(salesAgentIsProhibited('banking_access'), true);
  assert.equal(salesAgentIsProhibited('contract_signing'), true);
  assert.equal(salesAgentIsProhibited('unrestricted_discounts'), true);
  assert.equal(salesAgentIsProhibited('production_deployment'), true);
  assert.equal(salesAgentIsProhibited('continuing_after_opt_out'), true);
  assert.equal(salesAgentIsProhibited('draft_personalised_outreach'), false);
});
