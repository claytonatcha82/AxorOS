import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentRuntimeExecutionRecord } from './agent-runtime-state.js';
import { PRODUCTION_TECHNICAL_ASSISTANCE_CAPABILITY } from './production-model-capabilities.js';
import { createProductionRuntimeCommandService } from './production-runtime-command-service.js';

function record(destinationAgent: AgentRuntimeExecutionRecord['task']['destinationAgent'] = 'production_agent'): AgentRuntimeExecutionRecord {
  const now = '2026-08-18T17:20:00.000Z';
  return {
    task: {
      taskId: 'task-production-command',
      executionId: 'exec-production-command',
      originAgent: 'operations_agent',
      destinationAgent,
      objective: 'Execute governed Production work.',
      priority: 'normal',
      context: {},
      knowledgeReferences: [],
      inputs: {},
      expectedOutput: 'Governed Production result.',
      dependencies: [],
      risks: [],
      confidence: 1,
      approvalRequired: false,
      status: 'ready',
      nextAction: 'execute_destination_capability',
      attempt: 1,
      maxAttempts: 1,
      correlationId: 'corr-production-command',
      createdAt: now,
      updatedAt: now,
    },
    version: 1,
    persistedAt: now,
  };
}

test('Production runtime command executes only the server-controlled Production capability', async () => {
  const persisted = record();
  let captured: { executionId: string; capabilityId: string } | undefined;
  const service = createProductionRuntimeCommandService({
    store: { getExecution: async () => persisted },
    orchestrator: {
      execute: async (input) => {
        captured = input;
        return { record: persisted, replayed: false };
      },
    },
  });

  await service.execute('  exec-production-command  ');

  assert.deepEqual(captured, {
    executionId: 'exec-production-command',
    capabilityId: PRODUCTION_TECHNICAL_ASSISTANCE_CAPABILITY,
  });
});

test('Production runtime command rejects missing persisted execution', async () => {
  let orchestratorCalls = 0;
  const service = createProductionRuntimeCommandService({
    store: { getExecution: async () => null },
    orchestrator: {
      execute: async () => {
        orchestratorCalls += 1;
        throw new Error('should not execute');
      },
    },
  });

  await assert.rejects(() => service.execute('exec-missing'), /was not found/);
  assert.equal(orchestratorCalls, 0);
});

test('Production runtime command rejects persisted tasks for another destination agent', async () => {
  let orchestratorCalls = 0;
  const service = createProductionRuntimeCommandService({
    store: { getExecution: async () => record('sales_agent') },
    orchestrator: {
      execute: async () => {
        orchestratorCalls += 1;
        throw new Error('should not execute');
      },
    },
  });

  await assert.rejects(() => service.execute('exec-production-command'), /cannot execute destination agent sales_agent/);
  assert.equal(orchestratorCalls, 0);
});

test('Production runtime command rejects an empty execution ID before persistence lookup', async () => {
  let storeCalls = 0;
  const service = createProductionRuntimeCommandService({
    store: {
      getExecution: async () => {
        storeCalls += 1;
        return record();
      },
    },
    orchestrator: {
      execute: async () => ({ record: record(), replayed: false }),
    },
  });

  await assert.rejects(() => service.execute('   '), /executionId is required/);
  assert.equal(storeCalls, 0);
});
