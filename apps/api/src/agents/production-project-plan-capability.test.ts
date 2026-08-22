import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentRuntimeTask } from './agent-runtime-contract.js';
import { assertProductionProjectPlanContext } from './production-project-plan-capability.js';

function task(overrides: Partial<AgentRuntimeTask> = {}): AgentRuntimeTask {
  const now = '2026-08-22T11:30:00.000Z';
  return {
    taskId: 'task:production-plan:1',
    executionId: 'exec:production-plan:1',
    originAgent: 'operations_agent',
    destinationAgent: 'production_agent',
    objective: 'Create governed Production project plan.',
    priority: 'normal',
    context: {},
    knowledgeReferences: ['atlas:volume-1:client-delivery', 'atlas:volume-2:technology-stack'],
    inputs: {
      projectPackage: 'Approved client project package',
      atlasContext: 'Retrieved Atlas OS standards and project-delivery guidance',
    },
    expectedOutput: 'Structured Production project plan',
    dependencies: [],
    risks: [],
    confidence: 1,
    approvalRequired: false,
    status: 'ready',
    nextAction: 'execute_destination_capability',
    attempt: 1,
    maxAttempts: 1,
    correlationId: 'corr:production-plan:1',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

test('Production project planning accepts approved package with retrieved Atlas context and references', () => {
  assert.doesNotThrow(() => assertProductionProjectPlanContext(task()));
});

test('Production project planning rejects missing approved project package', () => {
  assert.throws(
    () => assertProductionProjectPlanContext(task({ inputs: { projectPackage: ' ', atlasContext: 'Atlas context' } })),
    /requires a non-empty projectPackage/,
  );
});

test('Production project planning rejects missing retrieved Atlas context', () => {
  assert.throws(
    () => assertProductionProjectPlanContext(task({ inputs: { projectPackage: 'Approved package', atlasContext: ' ' } })),
    /requires retrieved Atlas context/,
  );
});

test('Production project planning rejects missing authoritative knowledge references', () => {
  assert.throws(
    () => assertProductionProjectPlanContext(task({ knowledgeReferences: [] })),
    /requires authoritative knowledge references/,
  );
});
