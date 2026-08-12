import assert from 'node:assert/strict';
import test from 'node:test';
import { AgentRuntimeRegistry } from './agent-runtime-registry.js';

test('registry rejects duplicate registrations and disabled destinations', () => {
  const registry = new AgentRuntimeRegistry();
  registry.register({ agentId: 'sales_agent', enabled: true, capabilities: [{ capabilityId: 'proposal_conversion', description: 'Convert qualified opportunities.', acceptsHighRisk: false }] });
  assert.throws(() => registry.register({ agentId: 'sales_agent', enabled: true, capabilities: [{ capabilityId: 'other', description: 'Duplicate.', acceptsHighRisk: false }] }), /already registered/);
  registry.register({ agentId: 'finance_agent', enabled: false, capabilities: [{ capabilityId: 'financial_gate', description: 'Evaluate finance gate.', acceptsHighRisk: true }] });
  assert.throws(() => registry.requireEnabled('finance_agent'), /disabled/);
});

test('registry finds enabled agents by declared capability', () => {
  const registry = new AgentRuntimeRegistry();
  registry.register({ agentId: 'lead_agent', enabled: true, capabilities: [{ capabilityId: 'lead_qualification', description: 'Qualify leads.', acceptsHighRisk: false }] });
  registry.register({ agentId: 'sales_agent', enabled: true, capabilities: [{ capabilityId: 'proposal_conversion', description: 'Convert qualified opportunities.', acceptsHighRisk: false }] });
  assert.equal(registry.supports('lead_agent', 'lead_qualification'), true);
  assert.deepEqual(registry.findByCapability('proposal_conversion'), ['sales_agent']);
});
