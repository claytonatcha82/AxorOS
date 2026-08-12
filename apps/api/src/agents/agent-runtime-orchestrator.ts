import type { AgentRuntimeResult } from './agent-runtime-contract.js';
import { runtimeRetryRoute, canTransitionAgentExecution } from './agent-runtime-lifecycle.js';
import type { AgentRuntimeHandlerRegistry } from './agent-runtime-handlers.js';
import { recordRuntimeIdempotency, runtimeIdempotencyKey } from './agent-runtime-idempotency.js';
import { applyRuntimeEvent, type AgentRuntimeEvent, type AgentRuntimeExecutionRecord } from './agent-runtime-state.js';
import type { AgentRuntimeStore } from './agent-runtime-store.js';

export interface RuntimeOrchestratorDependencies {
  store: AgentRuntimeStore;
  handlers: AgentRuntimeHandlerRegistry;
  now?: () => string;
  createEventId?: () => string;
}

export interface ExecuteRuntimeTaskInput {
  executionId: string;
  capabilityId: string;
}

export interface RuntimeExecutionOutcome {
  record: AgentRuntimeExecutionRecord;
  replayed: boolean;
}

function validateHandlerResult(record: AgentRuntimeExecutionRecord, result: AgentRuntimeResult): void {
  if (result.executionId !== record.task.executionId) throw new Error('handler result executionId does not match runtime execution.');
  if (result.taskId !== record.task.taskId) throw new Error('handler result taskId does not match runtime task.');
  if (result.agentId !== record.task.destinationAgent) throw new Error('handler result agentId does not match destination agent.');
  if (!canTransitionAgentExecution(record.task.status, result.status)) {
    throw new Error(`handler result cannot transition runtime state from ${record.task.status} to ${result.status}.`);
  }
}

function transitionEvent(
  record: AgentRuntimeExecutionRecord,
  toStatus: AgentRuntimeEvent['toStatus'],
  type: AgentRuntimeEvent['type'],
  operation: string,
  occurredAt: string,
  eventId: string,
  payload: Record<string, unknown> = {},
): AgentRuntimeEvent {
  if (!toStatus) throw new Error('runtime transition requires a destination status.');
  return {
    eventId,
    executionId: record.task.executionId,
    taskId: record.task.taskId,
    correlationId: record.task.correlationId,
    type,
    actor: 'runtime',
    fromStatus: record.task.status,
    toStatus,
    payload,
    idempotencyKey: runtimeIdempotencyKey('runtime', record.task.executionId, operation),
    occurredAt,
  };
}

async function persistEvent(
  store: AgentRuntimeStore,
  previous: AgentRuntimeExecutionRecord,
  event: AgentRuntimeEvent,
  result?: AgentRuntimeResult,
): Promise<AgentRuntimeExecutionRecord> {
  const duplicate = await store.hasIdempotencyKey(event.idempotencyKey);
  if (duplicate) {
    const current = await store.getExecution(previous.task.executionId);
    if (!current) throw new Error('runtime idempotency record exists but execution state is missing.');
    return current;
  }

  let next = applyRuntimeEvent(previous, event);
  if (result) next = { ...next, result };
  await store.saveExecution(next, previous.version);
  await store.appendEvent(event);
  await store.saveIdempotencyRecord(recordRuntimeIdempotency(event, event.type));
  return next;
}

export function createAgentRuntimeOrchestrator(dependencies: RuntimeOrchestratorDependencies) {
  const now = dependencies.now ?? (() => new Date().toISOString());
  const createEventId = dependencies.createEventId ?? (() => crypto.randomUUID());

  return {
    async execute(input: ExecuteRuntimeTaskInput): Promise<RuntimeExecutionOutcome> {
      let record = await dependencies.store.getExecution(input.executionId);
      if (!record) throw new Error(`runtime execution ${input.executionId} was not found.`);

      const dispatchKey = runtimeIdempotencyKey('runtime', record.task.executionId, `dispatch:${input.capabilityId}`);
      if (await dependencies.store.hasIdempotencyKey(dispatchKey)) {
        const current = await dependencies.store.getExecution(input.executionId);
        if (!current) throw new Error('runtime dispatch idempotency record exists but execution state is missing.');
        return { record: current, replayed: true };
      }

      if (record.task.status !== 'ready') throw new Error(`runtime execution must be ready before execution; received ${record.task.status}.`);

      const handler = dependencies.handlers.require(record.task.destinationAgent, input.capabilityId);
      const dispatch = transitionEvent(record, 'in_progress', 'status_transitioned', `dispatch:${input.capabilityId}`, now(), createEventId(), {
        capabilityId: input.capabilityId,
      });
      record = await persistEvent(dependencies.store, record, dispatch);

      try {
        const result = await handler.execute(record.task);
        validateHandlerResult(record, result);
        const completion = transitionEvent(record, result.status, 'status_transitioned', `result:${input.capabilityId}:${record.task.attempt}`, now(), createEventId(), {
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
        const failure = transitionEvent(record, targetStatus, 'status_transitioned', `failure:${input.capabilityId}:${record.task.attempt}`, now(), createEventId(), {
          retryRoute: route,
          errorCode: failureResult.errorCode,
        });
        record = await persistEvent(dependencies.store, record, failure, failureResult);
        return { record, replayed: false };
      }
    },
  };
}
