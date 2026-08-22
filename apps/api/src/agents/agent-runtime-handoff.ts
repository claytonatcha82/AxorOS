import type { AgentRuntimeTask } from './agent-runtime-contract.js';
import { validateAgentRuntimeTask } from './agent-runtime-contract.js';
import type { FinanceClearanceDecisionReader } from './finance-clearance-gate.js';
import { assertPersistedFinanceCleared } from './finance-clearance-gate.js';
import type { AgentRuntimeRegistry } from './agent-runtime-registry.js';
import { validateRuntimeDestination } from './agent-runtime-routing.js';
import { assertPersistedOperationsReady, type OperationsProductionReadinessReader } from './trusted-production-operations-gate.js';

export interface HandoffDispatchResult {
  accepted: boolean;
  task: AgentRuntimeTask;
  reason: string;
}

export interface ProductionFinanceAuthorisation {
  clearanceId: string;
  commercialRecordReference: string;
  operationsReadinessId?: string;
}

function blockedProductionHandoff(task: AgentRuntimeTask, reason: string): HandoffDispatchResult {
  return {
    accepted: false,
    task: { ...task, status: 'blocked', nextAction: 'resolve_production_start_authority' },
    reason,
  };
}

function dispatchAuthorisedAgentHandoff(
  task: AgentRuntimeTask,
  capabilityId: string,
  registry: AgentRuntimeRegistry,
  productionAuthorised: boolean,
): HandoffDispatchResult {
  const validationErrors = validateAgentRuntimeTask(task);
  if (validationErrors.length) {
    return { accepted: false, task: { ...task, status: 'blocked', nextAction: 'correct_invalid_runtime_task' }, reason: validationErrors.join(' ') };
  }

  if (task.status !== 'ready') {
    return { accepted: false, task, reason: `task must be ready before dispatch; received ${task.status}.` };
  }

  if (task.destinationAgent === 'production_agent' && !productionAuthorised) {
    return blockedProductionHandoff(task, 'Production dispatch requires authoritative persisted Finance and Operations readiness evidence.');
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
  operationsReadinessReader?: OperationsProductionReadinessReader,
): Promise<HandoffDispatchResult> {
  if (task.destinationAgent !== 'production_agent') {
    return blockedProductionHandoff(task, 'Governed Production dispatch can only target production_agent.');
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

  try {
    await assertPersistedOperationsReady(
      operationsReadinessReader,
      authorisation.operationsReadinessId ?? '',
      authorisation.commercialRecordReference,
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Production start blocked: Operations readiness verification failed.';
    return blockedProductionHandoff(task, reason);
  }

  return dispatchAuthorisedAgentHandoff(task, capabilityId, registry, true);
}
