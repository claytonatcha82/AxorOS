import type { AgentRuntimeTask } from './agent-runtime-contract.js';
import { validateAgentRuntimeTask } from './agent-runtime-contract.js';
import type { AgentRuntimeRegistry } from './agent-runtime-registry.js';
import { validateRuntimeDestination } from './agent-runtime-routing.js';

export interface HandoffDispatchResult {
  accepted: boolean;
  task: AgentRuntimeTask;
  reason: string;
}

export function dispatchAgentHandoff(task: AgentRuntimeTask, capabilityId: string, registry: AgentRuntimeRegistry): HandoffDispatchResult {
  const validationErrors = validateAgentRuntimeTask(task);
  if (validationErrors.length) {
    return { accepted: false, task: { ...task, status: 'blocked', nextAction: 'correct_invalid_runtime_task' }, reason: validationErrors.join(' ') };
  }

  if (task.status !== 'ready') {
    return { accepted: false, task, reason: `task must be ready before dispatch; received ${task.status}.` };
  }

  const route = validateRuntimeDestination(task, capabilityId, registry);
  if (!route.approved) {
    return { accepted: false, task: { ...task, status: 'blocked', nextAction: 'resolve_routing_or_authority' }, reason: route.reason };
  }

  if (task.approvalRequired) {
    return { accepted: false, task: { ...task, status: 'review', nextAction: 'obtain_required_approval' }, reason: 'task requires approval before dispatch.' };
  }

  return {
    accepted: true,
    task: { ...task, status: 'in_progress', nextAction: 'execute_destination_capability', updatedAt: new Date().toISOString() },
    reason: 'handoff accepted and dispatched to authorised destination.',
  };
}
