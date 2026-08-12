import assert from 'node:assert/strict';
import test from 'node:test';
import { contentHasStrategicPillar, MARKETING_AGENT_CHARTER, marketingActionAuthority } from './marketing-agent-charter.js';

test('marketing optimises qualified inbound demand rather than content volume', () => {
  assert.equal(MARKETING_AGENT_CHARTER.primaryObjective, 'increase_qualified_inbound_demand');
  assert.equal(MARKETING_AGENT_CHARTER.role, 'AI Marketing Director / Brand Growth Agent');
});

test('marketing cannot take over sales pricing support or production', () => {
  assert.equal(marketingActionAuthority('direct_sales'), 'prohibited');
  assert.equal(marketingActionAuthority('create_proposal'), 'prohibited');
  assert.equal(marketingActionAuthority('set_pricing'), 'prohibited');
  assert.equal(marketingActionAuthority('client_support'), 'prohibited');
  assert.equal(marketingActionAuthority('website_production'), 'prohibited');
});

test('initial publishing and campaigns remain approval gated', () => {
  assert.equal(marketingActionAuthority('publish_content'), 'approval_required');
  assert.equal(marketingActionAuthority('launch_campaign'), 'approval_required');
  assert.equal(marketingActionAuthority('draft_content'), 'allowed');
});

test('random content without a strategic marketing pillar is invalid', () => {
  assert.equal(contentHasStrategicPillar([]), false);
  assert.equal(contentHasStrategicPillar(['trust']), true);
});
