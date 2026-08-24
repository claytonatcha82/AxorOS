import assert from 'node:assert/strict';
import test from 'node:test';
import type { CoreAgentId } from './agent-runtime-contract.js';
import type { RuntimeExecutionOutcome } from './agent-runtime-orchestrator.js';
import type { AgentRuntimeExecutionRecord } from './agent-runtime-state.js';
import { createPilotRuntimeOperatorCommand } from './pilot-runtime-operator-command.js';
import { SUPPORT_EMAIL_DRAFT_CAPABILITY } from './support-email-capabilities.js';
import { SUPPORT_INCIDENT_ANALYSIS_CAPABILITY } from './support-model-capabilities.js';

function record(
  destinationAgent: CoreAgentId,
  approvalOwner?: CoreAgentId | 'human_executive',
): AgentRuntimeExecutionRecord {
  const now = '2026-08-24T18:00:00.000Z';
  return {
    task: {
      taskId: 'task-pilot-operator',
      executionId: 'exec-pilot-operator',
      originAgent: 'operations_agent',
      destinationAgent,
      objective: 'Execute a governed pilot runtime task.',
      priority: 'normal',
      context: {},
      knowledgeReferences: [],
      inputs: {},
      expectedOutput: 'Governed result.',
      dependencies: [],
      risks: [],
      confidence: 1,
      approvalRequired: Boolean(approvalOwner),
      ...(approvalOwner ? { approvalOwner } : {}),
      status: approvalOwner ? 'review' : 'ready',
      nextAction: approvalOwner ? 'obtain_required_approval' : 'execute_destination_capability',
      attempt: 1,
      maxAttempts: 1,
      correlationId: 'corr-pilot-operator',
      createdAt: now,
      updatedAt: now,
    },
    version: 1,
    persistedAt: now,
  };
}

function outcome(current: AgentRuntimeExecutionRecord): RuntimeExecutionOutcome {
  return { record: current, replayed: false };
}

test('pilot operator lists only deterministically actionable pending approvals', async () => {
  const support = record('support_agent', 'human_executive');
  support.task.context = {
    supportEmailApprovalPolicy: {
      stage: 1,
      source: 'atlas_os',
      reason: 'Human Executive approval required for client communication.',
    },
  };
  const production = record('production_agent', 'human_executive');
  const command = createPilotRuntimeOperatorCommand({
    store: {
      async getExecution() { return support; },
      async listPendingHumanApprovals() { return [support, production]; },
    },
    orchestrator: {
      async execute() { throw new Error('not expected'); },
      async resolveApproval() { throw new Error('not expected'); },
    },
  });

  const approvals = await command.listPendingApprovals();
  assert.deepEqual(approvals, [{
    executionId: support.task.executionId,
    destinationAgent: 'support_agent',
    objective: support.task.objective,
    expectedOutput: support.task.expectedOutput,
    capabilityId: SUPPORT_EMAIL_DRAFT_CAPABILITY,
    persistedAt: support.persistedAt,
    reason: 'Human Executive approval required for client communication.',
  }]);
});

test('pilot operator executes only an approved capability for the persisted destination agent', async () => {
  const current = record('support_agent');
  let received: { executionId: string; capabilityId: string } | undefined;
  const command = createPilotRuntimeOperatorCommand({
    store: { async getExecution() { return current; } },
    orchestrator: {
      async execute(input) { received = input; return outcome(current); },
      async resolveApproval() { throw new Error('not expected'); },
    },
  });

  await command.execute(current.task.executionId, SUPPORT_INCIDENT_ANALYSIS_CAPABILITY);
  assert.deepEqual(received, {
    executionId: current.task.executionId,
    capabilityId: SUPPORT_INCIDENT_ANALYSIS_CAPABILITY,
  });
});

test('pilot operator cannot execute Production through the shared operator path', async () => {
  const current = record('production_agent');
  let calls = 0;
  const command = createPilotRuntimeOperatorCommand({
    store: { async getExecution() { return current; } },
    orchestrator: {
      async execute() { calls += 1; return outcome(current); },
      async resolveApproval() { throw new Error('not expected'); },
    },
  });

  await assert.rejects(
    command.execute(current.task.executionId, 'provide_technical_implementation_assistance'),
    /pilot operator cannot execute production_agent/,
  );
  assert.equal(calls, 0);
});

test('pilot operator resolves only Human Executive approvals and fixes the actor server-side', async () => {
  const current = record('support_agent', 'human_executive');
  let received: Parameters<ReturnType<typeof createPilotRuntimeOperatorCommand>['resolveApproval']> | undefined;
  let orchestratorInput: { executionId: string; actor: 'human_executive'; decision: 'approved' | 'rejected'; reason?: string } | undefined;
  const command = createPilotRuntimeOperatorCommand({
    store: { async getExecution() { return current; } },
    orchestrator: {
      async execute() { throw new Error('not expected'); },
      async resolveApproval(input) { orchestratorInput = input; return outcome(current); },
    },
  });

  received = [current.task.executionId, 'approved', 'Reviewed by the Human Executive.'];
  await command.resolveApproval(...received);
  assert.deepEqual(orchestratorInput, {
    executionId: current.task.executionId,
    actor: 'human_executive',
    decision: 'approved',
    reason: 'Reviewed by the Human Executive.',
  });
});

test('pilot operator rejects approvals owned by another agent before orchestration', async () => {
  const current = record('support_agent', 'operations_agent');
  let calls = 0;
  const command = createPilotRuntimeOperatorCommand({
    store: { async getExecution() { return current; } },
    orchestrator: {
      async execute() { throw new Error('not expected'); },
      async resolveApproval() { calls += 1; return outcome(current); },
    },
  });

  await assert.rejects(
    command.resolveApproval(current.task.executionId, 'approved'),
    /only Human Executive approvals/,
  );
  assert.equal(calls, 0);
});
