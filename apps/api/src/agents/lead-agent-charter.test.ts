import assert from 'node:assert/strict';
import test from 'node:test';
import { LEAD_AGENT_CHARTER, leadAgentMayPerform, marketTierIsServiceRestriction } from './lead-agent-charter.js';

test('lead agent is research and qualification intelligence rather than a sales sender', () => {
  assert.equal(LEAD_AGENT_CHARTER.role, 'Business Development Intelligence Agent');
  assert.equal(leadAgentMayPerform('send_email'), false);
  assert.equal(leadAgentMayPerform('send_proposal'), false);
  assert.equal(leadAgentMayPerform('create_invoice'), false);
  assert.equal(leadAgentMayPerform('sign_contract'), false);
});

test('lead agent may research and qualify but cannot invent data or advance CRM beyond qualification', () => {
  assert.equal(leadAgentMayPerform('research_company'), true);
  assert.equal(leadAgentMayPerform('qualify_lead'), true);
  assert.equal(leadAgentMayPerform('invent_business_data'), false);
  assert.equal(leadAgentMayPerform('change_crm_stage_beyond_qualification'), false);
});

test('market tiers are prioritisation only and never restrict global service availability', () => {
  assert.equal(marketTierIsServiceRestriction(), false);
  assert.equal(leadAgentMayPerform('reject_lead_only_because_international'), false);
});
