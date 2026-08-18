import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentRuntimeTask } from './agent-runtime-contract.js';
import { AgentRuntimeRegistry } from './agent-runtime-registry.js';
import { dispatchAgentHandoff, dispatchProductionHandoff } from './agent-runtime-handoff.js';

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
  registry.register({ agentId: 'production_agent', enabled: true, capabilities: [{ capabilityId: 'build_website', description: 'Build governed client website.', acceptsHighRisk: false }] });
  return registry;
}

const clearedReader = {
  async get(clearanceId: string) {
    if (clearanceId !== 'clearance-1') return null;
    return {
      state: 'FINANCE_CLEARED' as const,
      commercialRecordReference: 'commercial:test:1',
      reason: 'Provider payment evidence matches the governed commercial record.',
      evidenceReferences: ['payment-provider:test:event-1'],
    };
  },
};

function productionTask(overrides: Partial<AgentRuntimeTask> = {}): AgentRuntimeTask {
  return task({
    taskId: 'production-1',
    destinationAgent: 'production_agent',
    objective: 'Start website production',
    expectedOutput: 'Production build started',
    ...overrides,
  });
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

test('generic handoff cannot bypass Finance clearance for Production', () => {
  const result = dispatchAgentHandoff(productionTask(), 'build_website', registry());
  assert.equal(result.accepted, false);
  assert.equal(result.task.status, 'blocked');
  assert.equal(result.task.nextAction, 'resolve_finance_clearance');
  assert.match(result.reason, /persisted Finance clearance/);
});

test('Production handoff accepts authoritative persisted Finance clearance for the same commercial record', async () => {
  const result = await dispatchProductionHandoff(
    productionTask(),
    'build_website',
    registry(),
    clearedReader,
    { clearanceId: 'clearance-1', commercialRecordReference: 'commercial:test:1' },
  );
  assert.equal(result.accepted, true);
  assert.equal(result.task.status, 'in_progress');
});

test('Production handoff blocks when persisted Finance clearance is missing', async () => {
  const result = await dispatchProductionHandoff(
    productionTask(),
    'build_website',
    registry(),
    clearedReader,
    { clearanceId: 'missing-clearance', commercialRecordReference: 'commercial:test:1' },
  );
  assert.equal(result.accepted, false);
  assert.equal(result.task.nextAction, 'resolve_finance_clearance');
  assert.match(result.reason, /no persisted Finance clearance/);
});

test('Production handoff blocks when persisted Finance clearance is pending', async () => {
  const pendingReader = {
    async get() {
      return {
        state: 'FINANCE_PENDING' as const,
        commercialRecordReference: 'commercial:test:1',
        reason: 'Payment awaiting verification.',
        evidenceReferences: ['payment-provider:test:event-pending'],
      };
    },
  };

  const result = await dispatchProductionHandoff(
    productionTask(),
    'build_website',
    registry(),
    pendingReader,
    { clearanceId: 'clearance-pending', commercialRecordReference: 'commercial:test:1' },
  );
  assert.equal(result.accepted, false);
  assert.equal(result.task.nextAction, 'resolve_finance_clearance');
  assert.match(result.reason, /Payment awaiting verification/);
});

test('Production handoff blocks clearance from a different commercial record', async () => {
  const result = await dispatchProductionHandoff(
    productionTask(),
    'build_website',
    registry(),
    clearedReader,
    { clearanceId: 'clearance-1', commercialRecordReference: 'commercial:test:other' },
  );
  assert.equal(result.accepted, false);
  assert.equal(result.task.nextAction, 'resolve_finance_clearance');
  assert.match(result.reason, /does not match the governed commercial record/);
});
