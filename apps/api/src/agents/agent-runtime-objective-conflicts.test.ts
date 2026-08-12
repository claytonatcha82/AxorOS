import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentRuntimeTask } from './agent-runtime-contract.js';
import { evaluateRuntimeObjectiveConflict } from './agent-runtime-objective-conflicts.js';

const task: AgentRuntimeTask = {
  taskId: 'task-1',
  executionId: 'exec-1',
  originAgent: 'operations_agent',
  destinationAgent: 'sales_agent',
  objective: 'Convert qualified opportunity',
  priority: 'high',
  context: {},
  knowledgeReferences: [],
  inputs: {},
  expectedOutput: 'Commercial decision',
  dependencies: [],
  risks: [],
  confidence: 0.9,
  approvalRequired: false,
  status: 'ready',
  nextAction: 'execute_destination_capability',
  attempt: 1,
  maxAttempts: 3,
  correlationId: 'corr-1',
  createdAt: '2026-08-12T18:00:00.000Z',
  updatedAt: '2026-08-12T18:00:00.000Z',
};

function conflict(businessImpact: 'low' | 'medium' | 'high' | 'critical') {
  return {
    conflictId: `conflict-${businessImpact}`,
    agents: ['sales_agent', 'finance_agent'] as const,
    description: 'Sales conversion objective conflicts with financial control objective.',
    businessImpact,
    evidenceReferences: ['evidence-1'],
    recommendedResolution: 'Resolve commercial and financial constraints before execution.',
    escalationRequired: businessImpact === 'high' || businessImpact === 'critical',
  };
}

test('low and medium conflicts remain within Operations authority', () => {
  assert.equal(evaluateRuntimeObjectiveConflict(task, { ...conflict('medium'), agents: [...conflict('medium').agents] }).action, 'continue');
  assert.equal(evaluateRuntimeObjectiveConflict(task, { ...conflict('medium'), agents: [...conflict('medium').agents] }).owner, 'operations_agent');
});

test('high-impact conflicts route to Executive Agent review', () => {
  const decision = evaluateRuntimeObjectiveConflict(task, { ...conflict('high'), agents: [...conflict('high').agents] });
  assert.equal(decision.action, 'review');
  assert.equal(decision.owner, 'executive_agent');
});

test('critical conflicts route to Human Executive escalation', () => {
  const decision = evaluateRuntimeObjectiveConflict(task, { ...conflict('critical'), agents: [...conflict('critical').agents] });
  assert.equal(decision.action, 'escalate');
  assert.equal(decision.owner, 'human_executive');
});

test('runtime refuses a conflict unrelated to the destination agent', () => {
  assert.throws(
    () => evaluateRuntimeObjectiveConflict(task, {
      ...conflict('high'),
      agents: ['lead_agent', 'marketing_agent'],
    }),
    /does not involve destination agent/,
  );
});
