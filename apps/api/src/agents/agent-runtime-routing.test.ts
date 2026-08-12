import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentRuntimeTask } from './agent-runtime-contract.js';
import { AgentRuntimeRegistry } from './agent-runtime-registry.js';
import { resolveCapabilityDestination, validateRuntimeDestination } from './agent-runtime-routing.js';

function task(overrides: Partial<AgentRuntimeTask> = {}): AgentRuntimeTask {
  return {
    taskId: 't1', executionId: 'e1', originAgent: 'operations_agent', destinationAgent: 'finance_agent', objective: 'Check payment gate', priority: 'normal',
    context: {}, knowledgeReferences: [], inputs: {}, expectedOutput: 'Finance gate result', dependencies: [], risks: [], confidence: 1,
    approvalRequired: false, status: 'ready', nextAction: 'dispatch', attempt: 1, maxAttempts: 3, correlationId: 'c1', createdAt: '2026-08-12T00:00:00Z', updatedAt: '2026-08-12T00:00:00Z', ...overrides,
  };
}

test('routing rejects undeclared or unauthorised high-risk capabilities', () => {
  const registry = new AgentRuntimeRegistry();
  registry.register({ agentId: 'finance_agent', enabled: true, capabilities: [{ capabilityId: 'financial_gate', description: 'Evaluate finance gate.', acceptsHighRisk: false }] });
  assert.equal(validateRuntimeDestination(task(), 'unknown', registry).approved, false);
  const critical = validateRuntimeDestination(task({ priority: 'critical' }), 'financial_gate', registry);
  assert.equal(critical.approved, false);
  assert.match(critical.reason, /high-risk/);
});

test('automatic capability resolution requires one unambiguous enabled destination', () => {
  const registry = new AgentRuntimeRegistry();
  registry.register({ agentId: 'finance_agent', enabled: true, capabilities: [{ capabilityId: 'financial_gate', description: 'Evaluate finance gate.', acceptsHighRisk: true }] });
  assert.equal(resolveCapabilityDestination('financial_gate', registry), 'finance_agent');
  registry.register({ agentId: 'executive_agent', enabled: true, capabilities: [{ capabilityId: 'financial_gate', description: 'Review exceptional finance gate.', acceptsHighRisk: true }] });
  assert.equal(resolveCapabilityDestination('financial_gate', registry), null);
});
