import type { AgentRuntimeTask } from './agent-runtime-contract.js';
import { validateAgentRuntimeTask } from './agent-runtime-contract.js';
import type { FinanceClearanceDecisionReader } from './finance-clearance-gate.js';
import { assertPersistedFinanceCleared } from './finance-clearance-gate.js';
import type { AgentRuntimeRegistry } from './agent-runtime-registry.js';
import { validateRuntimeDestination } from './agent-runtime-routing.js';

export interface HandoffDispatchResult {
  accepted: boolean;
  task: AgentRuntimeTask;
  reason: string;
}

export interface ProductionFinanceAuthorisation {
  clearanceId: string;
  commercialRecordReference: string;
}

function blockedProductionHandoff(task: AgentRuntimeTask, reason: string): HandoffDispatchResult {
  return {
    accepted: false,
    task: { ...task, status: 'blocked', nextAction: 'resolve_finance_clearance' },
    reason,
  };
}

function dispatchAuthorisedAgentHandoff(
  task: AgentRuntimeTask,
  capabilityId: string,
  registry: AgentRuntimeRegistry,
  productionFinanceAuthorised: boolean,
): HandoffDispatchResult {
  const validationErrors = validateAgentRuntimeTask(task);
  if (validationErrors.length) {
    return { accepted: false, task: { ...task, status: 'blocked', nextAction: 'correct_invalid_runtime_task' }, reason: validationErrors.join(' ') };
  }

  if (task.status !== 'ready') {
    return { accepted: false, task, reason: `task must be ready before dispatch; received ${task.status}.` };
  }

  if (task.destinationAgent === 'production_agent' && !productionFinanceAuthorised) {
    return blockedProductionHandoff(task, 'Production dispatch requires authoritative persisted Finance clearance.');
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

export function dispatchAgentHandoff(task: AgentRuntimeTask, capabilityId: string, registry: AgentRuntimeRegistry): HandoffDispatchResult {
  return dispatchAuthorisedAgentHandoff(task, capabilityId, registry, false);
}

export async function dispatchProductionHandoff(
  task: AgentRuntimeTask,
  capabilityId: string,
  registry: AgentRuntimeRegistry,
  financeReader: FinanceClearanceDecisionReader,
  authorisation: ProductionFinanceAuthorisation,
): Promise<HandoffDispatchResult> {
  if (task.destinationAgent !== 'production_agent') {
    return blockedProductionHandoff(task, 'Finance-authorised Production dispatch can only target production_agent.');
  }

  let decision;
  try {
    decision = await assertPersistedFinanceCleared(financeReader, authorisation.clearanceId);
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Production start blocked: Finance clearance verification failed.';
    return blockedProductionHandoff(task, reason);
  }

  if (decision.commercialRecordReference !== authorisation.commercialRecordReference) {
    return blockedProductionHandoff(task, 'Production start blocked: Finance clearance does not match the governed commercial record.');
  }

  return dispatchAuthorisedAgentHandoff(task, capabilityId, registry, true);
}
