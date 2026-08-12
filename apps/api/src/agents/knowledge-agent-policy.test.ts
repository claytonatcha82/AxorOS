import assert from 'node:assert/strict';
import test from 'node:test';
import {
  KNOWLEDGE_AGENT_PERMISSIONS,
  knowledgeAgentIsProhibited,
  knowledgeAgentMayAccess,
} from './knowledge-agent-policy.js';

test('knowledge agent remains read-oriented and non-operational', () => {
  assert.equal(KNOWLEDGE_AGENT_PERMISSIONS.atlasOs, 'read');
  assert.equal(KNOWLEDGE_AGENT_PERMISSIONS.searchIndex, 'read');
  assert.equal(KNOWLEDGE_AGENT_PERMISSIONS.clientProjectKnowledge, 'controlled_read');
  assert.equal(KNOWLEDGE_AGENT_PERMISSIONS.email, 'none');
  assert.equal(KNOWLEDGE_AGENT_PERMISSIONS.payments, 'none');
  assert.equal(KNOWLEDGE_AGENT_PERMISSIONS.github, 'none_initially');
});

test('restricted secret values are never retrievable through the knowledge agent', () => {
  assert.equal(knowledgeAgentMayAccess('public'), true);
  assert.equal(knowledgeAgentMayAccess('internal'), true);
  assert.equal(knowledgeAgentMayAccess('confidential'), true);
  assert.equal(knowledgeAgentMayAccess('restricted'), false);
});

test('knowledge agent cannot take business or client-facing authority', () => {
  assert.equal(knowledgeAgentIsProhibited('change_business_policy'), true);
  assert.equal(knowledgeAgentIsProhibited('rewrite_atlas_automatically'), true);
  assert.equal(knowledgeAgentIsProhibited('send_email'), true);
  assert.equal(knowledgeAgentIsProhibited('make_payments'), true);
  assert.equal(knowledgeAgentIsProhibited('deploy_websites'), true);
  assert.equal(knowledgeAgentIsProhibited('make_executive_decisions'), true);
});
