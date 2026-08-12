import type { AgentObjectiveConflict } from './agent-objective-conflicts.js';
import type { AgentRuntimeResult, AgentRuntimeTask, CoreAgentId } from './agent-runtime-contract.js';
import { findCircularDependencies, resolveTaskDependencies, taskParticipatesInCycle } from './agent-runtime-dependencies.js';
import type { AgentRuntimeHandlerRegistry } from './agent-runtime-handlers.js';
import { recordRuntimeIdempotency, runtimeIdempotencyKey } from './agent-runtime-idempotency.js';
import { runtimeRetryRoute, canTransitionAgentExecution } from './agent-runtime-lifecycle.js';
import { evaluateRuntimeObjectiveConflict } from './agent-runtime-objective-conflicts.js';
import { canScheduleForCapacity, type AgentCapacity } from './agent-runtime-scheduler.js';
import { applyRuntimeEvent, type AgentRuntimeEvent, type AgentRuntimeExecutionRecord } from './agent-runtime-state.js';
import type { AgentRuntimeStore } from './agent-runtime-store.js';

export interface RuntimeOrchestratorDependencies {
  store: AgentRuntimeStore;
  handlers: AgentRuntimeHandlerRegistry;
  now?: () => string;
  createEventId?: () => string;
}

export interface RuntimeSchedulingContext {
  tasks: readonly AgentRuntimeTask[];
  capacity: AgentCapacity;
}

export interface ExecuteRuntimeTaskInput {
  executionId: string;
  capabilityId: string;
  objectiveConflict?: AgentObjectiveConflict;
  scheduling?: RuntimeSchedulingContext;
}

export interface ResolveRuntimeApprovalInput {
  executionId: string;
  actor: CoreAgentId | 'human_executive';
  decision: 'approved' | 'rejected';
  reason?: string;
}

export interface RetryRuntimeTaskInput {
  executionId: string;
  capabilityId: string;
  alternativeCapabilityId?: string;
}

export interface RuntimeExecutionOutcome {
  record: AgentRuntimeExecutionRecord;
  replayed: boolean;
}

export interface RuntimeRetryOutcome extends RuntimeExecutionOutcome {
  route: 'retry_same' | 'retry_alternative' | 'escalate';
  nextCapabilityId?: string;
}

function validateHandlerResult(record: AgentRuntimeExecutionRecord, result: AgentRuntimeResult): void {
  if (result.executionId !== record.task.executionId) throw new Error('handler result executionId does not match runtime execution.');
  if (result.taskId !== record.task.taskId) throw new Error('handler result taskId does not match runtime task.');
  if (result.agentId !== record.task.destinationAgent) throw new Error('handler result agentId does not match destination agent.');
  if (!canTransitionAgentExecution(record.task.status, result.status)) {
    throw new Error(`handler result cannot transition runtime state from ${record.task.status} to ${result.status}.`);
  }
}

function event(
  record: AgentRuntimeExecutionRecord,
  type: AgentRuntimeEvent['type'],
  operation: string,
  occurredAt: string,
  eventId: string,
  payload: Record<string, unknown> = {},
): AgentRuntimeEvent {
  return {
    eventId,
    executionId: record.task.executionId,
    taskId: record.task.taskId,
    correlationId: record.task.correlationId,
    type,
    actor: 'runtime',
    payload,
    idempotencyKey: runtimeIdempotencyKey('runtime', record.task.executionId, operation),
    occurredAt,
  };
}

function transitionEvent(
  record: AgentRuntimeExecutionRecord,
  toStatus: AgentRuntimeEvent['toStatus'],
  operation: string,
  occurredAt: string,
  eventId: string,
  payload: Record<string, unknown> = {},
): AgentRuntimeEvent {
  if (!toStatus) throw new Error('runtime transition requires a destination status.');
  return {
    ...event(record, 'status_transitioned', operation, occurredAt, eventId, payload),
    fromStatus: record.task.status,
    toStatus,
  };
}

async function persistEvent(
  store: AgentRuntimeStore,
  previous: AgentRuntimeExecutionRecord,
  runtimeEvent: AgentRuntimeEvent,
  result?: AgentRuntimeResult,
  updateTask?: (task: AgentRuntimeExecutionRecord['task']) => AgentRuntimeExecutionRecord['task'],
): Promise<AgentRuntimeExecutionRecord> {
  const duplicate = await store.hasIdempotencyKey(runtimeEvent.idempotencyKey);
  if (duplicate) {
    const current = await store.getExecution(previous.task.executionId);
    if (!current) throw new Error('runtime idempotency record exists but execution state is missing.');
    return current;
  }

  let next = applyRuntimeEvent(previous, runtimeEvent);
  if (updateTask) next = { ...next, task: updateTask(next.task) };
  if (result) next = { ...next, result };
  await store.saveExecution(next, previous.version);
  await store.appendEvent(runtimeEvent);
  await store.saveIdempotencyRecord(recordRuntimeIdempotency(runtimeEvent, runtimeEvent.type));
  return next;
}

function schedulingTasks(record: AgentRuntimeExecutionRecord, context: RuntimeSchedulingContext): AgentRuntimeTask[] {
  const tasks = context.tasks.filter((task) => task.taskId !== record.task.taskId);
  return [...tasks, record.task];
}

export function createAgentRuntimeOrchestrator(dependencies: RuntimeOrchestratorDependencies) {
  const now = dependencies.now ?? (() => new Date().toISOString());
  const createEventId = dependencies.createEventId ?? (() => crypto.randomUUID());

  return {
    async execute(input: ExecuteRuntimeTaskInput): Promise<RuntimeExecutionOutcome> {
      let record = await dependencies.store.getExecution(input.executionId);
      if (!record) throw new Error(`runtime execution ${input.executionId} was not found.`);

      const dispatchOperation = `dispatch:${input.capabilityId}:${record.task.attempt}`;
      const dispatchKey = runtimeIdempotencyKey('runtime', record.task.executionId, dispatchOperation);
      if (await dependencies.store.hasIdempotencyKey(dispatchKey)) {
        const current = await dependencies.store.getExecution(input.executionId);
        if (!current) throw new Error('runtime dispatch idempotency record exists but execution state is missing.');
        return { record: current, replayed: true };
      }

      if (record.task.status !== 'ready' && !(record.task.status === 'waiting' && input.scheduling)) {
        throw new Error(`runtime execution must be ready before execution; received ${record.task.status}.`);
      }

      if (input.scheduling) {
        const tasks = schedulingTasks(record, input.scheduling);
        const tasksById = new Map(tasks.map((task) => [task.taskId, task]));
        const cycles = findCircularDependencies(tasks);
        const operation = `scheduling:${record.task.attempt}`;

        if (taskParticipatesInCycle(record.task.taskId, cycles)) {
          if (record.task.status !== 'blocked') {
            const blocked = transitionEvent(record, 'blocked', `${operation}:cycle`, now(), createEventId(), {
              decision: 'blocked_cycle',
              owner: 'operations_agent',
            });
            record = await persistEvent(dependencies.store, record, blocked, undefined, (task) => ({
              ...task,
              nextAction: 'operations_resolve_dependency_cycle',
            }));
          }
          return { record, replayed: false };
        }

        const dependencyResolution = resolveTaskDependencies(record.task, tasksById);
        if (!dependencyResolution.ready) {
          if (record.task.status === 'ready') {
            const waiting = transitionEvent(record, 'waiting', `${operation}:dependencies`, now(), createEventId(), {
              decision: 'waiting_dependencies',
              missingDependencies: dependencyResolution.missingDependencies,
              incompleteDependencies: dependencyResolution.incompleteDependencies,
              owner: 'operations_agent',
            });
            record = await persistEvent(dependencies.store, record, waiting, undefined, (task) => ({
              ...task,
              nextAction: 'wait_for_dependencies',
            }));
          }
          return { record, replayed: false };
        }

        if (!canScheduleForCapacity(record.task, input.scheduling.capacity)) {
          if (record.task.status === 'ready') {
            const waiting = transitionEvent(record, 'waiting', `${operation}:capacity`, now(), createEventId(), {
              decision: 'deferred_capacity',
              capacityState: input.scheduling.capacity.state,
              activeTasks: input.scheduling.capacity.activeTasks,
              maxConcurrentTasks: input.scheduling.capacity.maxConcurrentTasks,
              owner: 'operations_agent',
            });
            record = await persistEvent(dependencies.store, record, waiting, undefined, (task) => ({
              ...task,
              nextAction: 'wait_for_destination_capacity',
            }));
          }
          return { record, replayed: false };
        }

        if (record.task.status === 'waiting') {
          const ready = transitionEvent(record, 'ready', `${operation}:ready`, now(), createEventId(), {
            decision: 'ready',
            owner: 'operations_agent',
          });
          record = await persistEvent(dependencies.store, record, ready, undefined, (task) => ({
            ...task,
            nextAction: 'execute_destination_capability',
          }));
        }
      }

      if (input.objectiveConflict) {
        const decision = evaluateRuntimeObjectiveConflict(record.task, input.objectiveConflict);
        const operation = `objective-conflict:${input.objectiveConflict.conflictId}:${record.task.attempt}`;
        const conflictEvent = event(record, 'execution_escalated', operation, now(), createEventId(), {
          conflictId: input.objectiveConflict.conflictId,
          businessImpact: input.objectiveConflict.businessImpact,
          owner: decision.owner,
          action: decision.action,
          reason: decision.reason,
        });
        record = await persistEvent(dependencies.store, record, conflictEvent);

        if (decision.action === 'review') {
          const review = transitionEvent(record, 'review', `${operation}:review`, now(), createEventId(), {
            conflictId: input.objectiveConflict.conflictId,
            owner: decision.owner,
          });
          record = await persistEvent(dependencies.store, record, review, undefined, (task) => ({
            ...task,
            approvalRequired: true,
            approvalOwner: decision.owner,
            nextAction: 'resolve_objective_conflict',
          }));
          return { record, replayed: false };
        }

        if (decision.action === 'escalate') {
          const escalated = transitionEvent(record, 'escalated', `${operation}:escalated`, now(), createEventId(), {
            conflictId: input.objectiveConflict.conflictId,
            owner: decision.owner,
          });
          record = await persistEvent(dependencies.store, record, escalated, undefined, (task) => ({
            ...task,
            nextAction: 'human_executive_resolve_objective_conflict',
          }));
          return { record, replayed: false };
        }
      }

      if (record.task.approvalRequired) {
        const approvalOwner = record.task.approvalOwner;
        if (!approvalOwner) throw new Error('approvalRequired runtime task is missing approvalOwner.');
        const requested = event(record, 'approval_requested', `approval-requested:${record.task.attempt}`, now(), createEventId(), { approvalOwner });
        record = await persistEvent(dependencies.store, record, requested);
        const review = transitionEvent(record, 'review', `approval-review:${record.task.attempt}`, now(), createEventId(), { approvalOwner });
        record = await persistEvent(dependencies.store, record, review, undefined, (task) => ({ ...task, nextAction: 'obtain_required_approval' }));
        return { record, replayed: false };
      }

      const handler = dependencies.handlers.require(record.task.destinationAgent, input.capabilityId);
      const dispatch = transitionEvent(record, 'in_progress', dispatchOperation, now(), createEventId(), {
        capabilityId: input.capabilityId,
      });
      record = await persistEvent(dependencies.store, record, dispatch);

      try {
        const result = await handler.execute(record.task);
        validateHandlerResult(record, result);
        const completion = transitionEvent(record, result.status, `result:${input.capabilityId}:${record.task.attempt}`, now(), createEventId(), {
          confidence: result.confidence,
        });
        record = await persistEvent(dependencies.store, record, completion, result);
        return { record, replayed: false };
      } catch (error) {
        const highRisk = record.task.priority === 'critical' || record.task.risks.length > 0;
        const route = runtimeRetryRoute(record.task.attempt, highRisk);
        const targetStatus = route === 'escalate' ? 'escalated' : 'failed';
        const failureResult: AgentRuntimeResult = {
          executionId: record.task.executionId,
          taskId: record.task.taskId,
          agentId: record.task.destinationAgent,
          status: targetStatus,
          output: {},
          evidenceReferences: [],
          knowledgeReferences: record.task.knowledgeReferences,
          confidence: 0,
          errorCode: 'RUNTIME_HANDLER_FAILURE',
          errorMessage: error instanceof Error ? error.message : String(error),
          completedAt: now(),
        };
        const failure = transitionEvent(record, targetStatus, `failure:${input.capabilityId}:${record.task.attempt}`, now(), createEventId(), {
          retryRoute: route,
          errorCode: failureResult.errorCode,
        });
        record = await persistEvent(dependencies.store, record, failure, failureResult, (task) => ({
          ...task,
          nextAction: route === 'escalate' ? 'escalate_to_operations_or_executive' : 'schedule_governed_retry',
        }));
        return { record, replayed: false };
      }
    },

    async resolveApproval(input: ResolveRuntimeApprovalInput): Promise<RuntimeExecutionOutcome> {
      let record = await dependencies.store.getExecution(input.executionId);
      if (!record) throw new Error(`runtime execution ${input.executionId} was not found.`);
      if (record.task.status !== 'review') throw new Error(`runtime approval requires review status; received ${record.task.status}.`);
      if (!record.task.approvalRequired || !record.task.approvalOwner) throw new Error('runtime execution is not awaiting a governed approval.');
      if (record.task.approvalOwner !== input.actor) throw new Error(`runtime approval must be resolved by ${record.task.approvalOwner}.`);

      const operation = `approval-${input.decision}:${record.task.attempt}`;
      const idempotencyKey = runtimeIdempotencyKey('runtime', record.task.executionId, operation);
      if (await dependencies.store.hasIdempotencyKey(idempotencyKey)) {
        const current = await dependencies.store.getExecution(input.executionId);
        if (!current) throw new Error('runtime approval idempotency record exists but execution state is missing.');
        return { record: current, replayed: true };
      }

      const approvalEvent = event(
        record,
        input.decision === 'approved' ? 'approval_granted' : 'approval_rejected',
        operation,
        now(),
        createEventId(),
        { actor: input.actor, ...(input.reason ? { reason: input.reason } : {}) },
      );
      record = await persistEvent(dependencies.store, record, approvalEvent);

      if (input.decision === 'approved') {
        const approved = transitionEvent(record, 'ready', `approval-ready:${record.task.attempt}`, now(), createEventId(), { actor: input.actor });
        record = await persistEvent(dependencies.store, record, approved, undefined, (task) => ({
          ...task,
          approvalRequired: false,
          nextAction: 'execute_destination_capability',
        }));
      } else {
        const rejected = transitionEvent(record, 'escalated', `approval-escalated:${record.task.attempt}`, now(), createEventId(), { actor: input.actor });
        record = await persistEvent(dependencies.store, record, rejected, undefined, (task) => ({
          ...task,
          nextAction: 'resolve_rejected_approval',
        }));
      }

      return { record, replayed: false };
    },

    async retry(input: RetryRuntimeTaskInput): Promise<RuntimeRetryOutcome> {
      let record = await dependencies.store.getExecution(input.executionId);
      if (!record) throw new Error(`runtime execution ${input.executionId} was not found.`);
      if (record.task.status !== 'failed') throw new Error(`runtime retry requires failed status; received ${record.task.status}.`);

      const highRisk = record.task.priority === 'critical' || record.task.risks.length > 0;
      let route = runtimeRetryRoute(record.task.attempt, highRisk);
      if (record.task.attempt >= record.task.maxAttempts) route = 'escalate';

      if (route === 'escalate') {
        const escalated = transitionEvent(record, 'escalated', `retry-escalated:${record.task.attempt}`, now(), createEventId(), { retryRoute: route });
        record = await persistEvent(dependencies.store, record, escalated, undefined, (task) => ({
          ...task,
          nextAction: 'escalate_to_operations_or_executive',
        }));
        return { record, replayed: false, route };
      }

      const nextCapabilityId = route === 'retry_same' ? input.capabilityId : input.alternativeCapabilityId;
      if (!nextCapabilityId) throw new Error('alternativeCapabilityId is required for retry_alternative routing.');
      dependencies.handlers.require(record.task.destinationAgent, nextCapabilityId);

      const retryOperation = `retry-scheduled:${record.task.attempt}:${route}:${nextCapabilityId}`;
      const retryKey = runtimeIdempotencyKey('runtime', record.task.executionId, retryOperation);
      if (await dependencies.store.hasIdempotencyKey(retryKey)) {
        const current = await dependencies.store.getExecution(input.executionId);
        if (!current) throw new Error('runtime retry idempotency record exists but execution state is missing.');
        return { record: current, replayed: true, route, nextCapabilityId };
      }

      const scheduled = event(record, 'retry_scheduled', retryOperation, now(), createEventId(), {
        retryRoute: route,
        capabilityId: nextCapabilityId,
        nextAttempt: record.task.attempt + 1,
      });
      record = await persistEvent(dependencies.store, record, scheduled);

      const ready = transitionEvent(record, 'ready', `retry-ready:${record.task.attempt}:${route}`, now(), createEventId(), { retryRoute: route });
      record = await persistEvent(dependencies.store, record, ready, undefined, (task) => ({
        ...task,
        attempt: task.attempt + 1,
        context: { ...task.context, runtimeRetryCapabilityId: nextCapabilityId, runtimeRetryRoute: route },
        nextAction: route === 'retry_same' ? 'retry_same_capability' : 'retry_alternative_capability',
      }));

      return { record, replayed: false, route, nextCapabilityId };
    },
  };
}
