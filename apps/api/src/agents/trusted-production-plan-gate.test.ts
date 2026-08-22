import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentRuntimeTask } from './agent-runtime-contract.js';
import { assertTrustedProductionPlanGate } from './trusted-production-plan-gate.js';

function task(overrides: Partial<AgentRuntimeTask> = {}): AgentRuntimeTask {
  return {
    taskId: 'task:implementation:1',
    executionId: 'exec:implementation:1',
    originAgent: 'operations_agent',
    destinationAgent: 'production_agent',
    objective: 'Draft governed implementation.',
    priority: 'normal',
    context: {
      commercialRecordReference: 'commercial:test:1',
      productionPlanExecutionId: 'exec:plan:1',
    },
    knowledgeReferences: ['atlas:production'],
    inputs: { implementationBrief: 'Implement from the approved plan.' },
    expectedOutput: 'Implementation draft',
    dependencies: [],
    risks: [],
    confidence: 1,
    approvalRequired: false,
    status: 'ready',
    nextAction: 'execute_destination_capability',
    attempt: 1,
    maxAttempts: 1,
    correlationId: 'corr:implementation:1',
    createdAt: '2026-08-22T12:00:00.000Z',
    updatedAt: '2026-08-22T12:00:00.000Z',
    ...overrides,
  };
}

const defaultExecutionRow = {
  destination_agent: 'production_agent',
  status: 'completed',
  task: {
    context: { commercialRecordReference: 'commercial:test:1' },
  },
  result: {
    status: 'completed',
    evidenceReferences: ['model:gemini:plan:1'],
  },
};

function poolHarness(options: {
  executionRow?: Record<string, unknown> | null;
  dispatchCount?: number;
} = {}) {
  const executionRow = Object.hasOwn(options, 'executionRow') ? options.executionRow : defaultExecutionRow;
  const dispatchCount = options.dispatchCount ?? 1;
  return {
    async query(sql: string) {
      if (sql.includes('from runtime.agent_executions')) {
        return { rows: executionRow ? [executionRow] : [], rowCount: executionRow ? 1 : 0 };
      }
      if (sql.includes('from runtime.agent_events')) {
        return { rows: dispatchCount > 0 ? [{ '?column?': 1 }] : [], rowCount: dispatchCount };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
}

test('trusted Production plan gate accepts matching completed governed plan evidence', async () => {
  await assert.doesNotReject(() => assertTrustedProductionPlanGate(task(), { pool: poolHarness() as never }));
});

test('trusted Production plan gate rejects missing plan reference and unconfigured evidence store', async () => {
  await assert.rejects(
    () => assertTrustedProductionPlanGate(task({ context: { commercialRecordReference: 'commercial:test:1' } }), { pool: poolHarness() as never }),
    /Production plan execution reference is required/,
  );
  await assert.rejects(() => assertTrustedProductionPlanGate(task(), {}), /evidence store is not configured/);
});

test('trusted Production plan gate rejects missing, wrong-agent, incomplete, mismatched, or evidence-free plans', async () => {
  await assert.rejects(
    () => assertTrustedProductionPlanGate(task(), { pool: poolHarness({ executionRow: null }) as never }),
    /plan execution was not found/,
  );
  await assert.rejects(
    () => assertTrustedProductionPlanGate(task(), { pool: poolHarness({ executionRow: {
      destination_agent: 'sales_agent', status: 'completed', task: { context: { commercialRecordReference: 'commercial:test:1' } }, result: { status: 'completed', evidenceReferences: ['evidence:1'] },
    } }) as never }),
    /wrong agent/,
  );
  await assert.rejects(
    () => assertTrustedProductionPlanGate(task(), { pool: poolHarness({ executionRow: {
      destination_agent: 'production_agent', status: 'failed', task: { context: { commercialRecordReference: 'commercial:test:1' } }, result: { status: 'failed', evidenceReferences: ['evidence:1'] },
    } }) as never }),
    /not completed/,
  );
  await assert.rejects(
    () => assertTrustedProductionPlanGate(task(), { pool: poolHarness({ executionRow: {
      destination_agent: 'production_agent', status: 'completed', task: { context: { commercialRecordReference: 'commercial:other' } }, result: { status: 'completed', evidenceReferences: ['evidence:1'] },
    } }) as never }),
    /commercial record does not match/,
  );
  await assert.rejects(
    () => assertTrustedProductionPlanGate(task(), { pool: poolHarness({ executionRow: {
      destination_agent: 'production_agent', status: 'completed', task: { context: { commercialRecordReference: 'commercial:test:1' } }, result: { status: 'completed', evidenceReferences: [] },
    } }) as never }),
    /no provider evidence/,
  );
});

test('trusted Production plan gate rejects execution not produced by project-planning capability', async () => {
  await assert.rejects(
    () => assertTrustedProductionPlanGate(task(), { pool: poolHarness({ dispatchCount: 0 }) as never }),
    /not produced by the governed project-planning capability/,
  );
});
