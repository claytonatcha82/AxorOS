import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentRuntimeTask } from './agent-runtime-contract.js';
import { AgentRuntimeRegistry } from './agent-runtime-registry.js';
import { dispatchAgentHandoff } from './agent-runtime-handoff.js';

function task(overrides: Partial<AgentRuntimeTask> = {}): AgentRuntimeTask {
  return {
    taskId: 't1', executionId: 'e1', originAgent: 'operations_agent', destinationAgent: 'finance_agent', objective: 'Check payment gate', priority: 'normal',
    context: {}, knowledgeReferences: [], inputs: {}, expectedOutput: 'Finance gate result', dependencies: [], risks: [], confidence: 1,
    approvalRequired: false, status: 'ready', nextAction: 'dispatch', attempt: 1, maxAttempts: 3, correlationId: 'c1', createdAt: '2026-08-12T00:00:00Z', updatedAt: '2026-08-12T00:00:00Z', ...overrides,
  };
}

function registry(): AgentRuntimeRegistry {
  const registry = new AgentRuntimeRegistry();
  registry.register({ agentId: 'finance_agent', enabled: true, capabilities: [{ capabilityId: 'financial_gate', description: 'Evaluate finance gate.', acceptsHighRisk: true }] });
  return registry;
}

test('handoff dispatch requires a valid ready task and authorised destination capability', () => {
  const result = dispatchAgentHandoff(task(), 'financial_gate', registry());
  assert.equal(result.accepted, true);
  assert.equal(result.task.status, 'in_progress');
  assert.equal(result.task.nextAction, 'execute_destination_capability');
});

test('approval-gated tasks enter review rather than executing', () => {
  const result = dispatchAgentHandoff(task({ approvalRequired: true, approvalOwner: 'human_executive' }), 'financial_gate', registry());
  assert.equal(result.accepted, false);
  assert.equal(result.task.status, 'review');
  assert.equal(result.task.nextAction, 'obtain_required_approval');
});

test('invalid routing blocks the task rather than silently dispatching', () => {
  const result = dispatchAgentHandoff(task(), 'invoice_refund', registry());
  assert.equal(result.accepted, false);
  assert.equal(result.task.status, 'blocked');
  assert.equal(result.task.nextAction, 'resolve_routing_or_authority');
});
