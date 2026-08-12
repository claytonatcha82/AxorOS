import type { AgentExecutionStatus, AgentRuntimeResult, AgentRuntimeTask, CoreAgentId } from './agent-runtime-contract.js';
import { canTransitionAgentExecution } from './agent-runtime-lifecycle.js';

export type AgentRuntimeEventType =
  | 'task_created'
  | 'status_transitioned'
  | 'dispatch_requested'
  | 'dispatch_succeeded'
  | 'dispatch_failed'
  | 'approval_requested'
  | 'approval_granted'
  | 'approval_rejected'
  | 'retry_scheduled'
  | 'result_recorded'
  | 'execution_escalated'
  | 'execution_cancelled';

export interface AgentRuntimeExecutionRecord {
  task: AgentRuntimeTask;
  result?: AgentRuntimeResult;
  version: number;
  lastEventId?: string;
  persistedAt: string;
}

export interface AgentRuntimeEvent {
  eventId: string;
  executionId: string;
  taskId: string;
  correlationId: string;
  type: AgentRuntimeEventType;
  actor: CoreAgentId | 'human_executive' | 'runtime';
  fromStatus?: AgentExecutionStatus;
  toStatus?: AgentExecutionStatus;
  payload: Record<string, unknown>;
  idempotencyKey: string;
  occurredAt: string;
}

export function validateRuntimeEvent(event: AgentRuntimeEvent): string[] {
  const errors: string[] = [];
  if (!event.eventId.trim()) errors.push('eventId is required.');
  if (!event.executionId.trim()) errors.push('executionId is required.');
  if (!event.taskId.trim()) errors.push('taskId is required.');
  if (!event.correlationId.trim()) errors.push('correlationId is required.');
  if (!event.idempotencyKey.trim()) errors.push('idempotencyKey is required.');
  if (event.type === 'status_transitioned') {
    if (!event.fromStatus || !event.toStatus) errors.push('status transitions require fromStatus and toStatus.');
    else if (!canTransitionAgentExecution(event.fromStatus, event.toStatus)) errors.push(`invalid runtime status transition: ${event.fromStatus} -> ${event.toStatus}.`);
  }
  return errors;
}

export function applyRuntimeEvent(record: AgentRuntimeExecutionRecord, event: AgentRuntimeEvent): AgentRuntimeExecutionRecord {
  if (record.task.executionId !== event.executionId) throw new Error('event executionId does not match runtime record.');
  if (record.task.taskId !== event.taskId) throw new Error('event taskId does not match runtime record.');

  const errors = validateRuntimeEvent(event);
  if (errors.length) throw new Error(errors.join(' '));

  let task = record.task;
  if (event.type === 'status_transitioned' && event.toStatus) {
    if (task.status !== event.fromStatus) throw new Error('event fromStatus does not match persisted runtime state.');
    task = { ...task, status: event.toStatus, updatedAt: event.occurredAt };
  }

  return {
    ...record,
    task,
    version: record.version + 1,
    lastEventId: event.eventId,
    persistedAt: event.occurredAt,
  };
}
