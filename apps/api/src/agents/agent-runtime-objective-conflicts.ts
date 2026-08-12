import type { AgentObjectiveConflict } from './agent-objective-conflicts.js';
import { objectiveConflictRoute, validateObjectiveConflict } from './agent-objective-conflicts.js';
import type { AgentRuntimeTask, CoreAgentId } from './agent-runtime-contract.js';

export type RuntimeObjectiveConflictAction = 'continue' | 'review' | 'escalate';

export interface RuntimeObjectiveConflictDecision {
  action: RuntimeObjectiveConflictAction;
  owner: CoreAgentId | 'human_executive';
  reason: string;
  conflict: AgentObjectiveConflict;
}

export function evaluateRuntimeObjectiveConflict(
  task: AgentRuntimeTask,
  conflict: AgentObjectiveConflict,
): RuntimeObjectiveConflictDecision {
  const errors = validateObjectiveConflict(conflict);
  if (errors.length) throw new Error(errors.join(' '));

  if (!conflict.agents.includes(task.destinationAgent)) {
    throw new Error(`objective conflict ${conflict.conflictId} does not involve destination agent ${task.destinationAgent}.`);
  }

  const route = objectiveConflictRoute(conflict);
  if (route === 'human_executive') {
    return {
      action: 'escalate',
      owner: 'human_executive',
      reason: 'critical objective conflict requires Human Executive resolution.',
      conflict,
    };
  }
  if (route === 'executive') {
    return {
      action: 'review',
      owner: 'executive_agent',
      reason: 'high-impact objective conflict requires Executive Agent review.',
      conflict,
    };
  }
  return {
    action: 'continue',
    owner: 'operations_agent',
    reason: 'low/medium objective conflict remains within Operations authority.',
    conflict,
  };
}
