import { recordRuntimeIdempotency, runtimeIdempotencyKey } from './agent-runtime-idempotency.js';
import { applyRuntimeEvent, type AgentRuntimeEvent, type AgentRuntimeExecutionRecord } from './agent-runtime-state.js';
import type { AgentRuntimeStore } from './agent-runtime-store.js';

export interface RuntimeRecoveryOptions {
  staleAfterMs: number;
  limit?: number;
  now?: () => string;
  createEventId?: () => string;
}

export interface RuntimeRecoveryDecision {
  executionId: string;
  action: 'review' | 'escalate' | 'skipped_duplicate';
  record: AgentRuntimeExecutionRecord;
}

function recoveryEvent(
  record: AgentRuntimeExecutionRecord,
  toStatus: 'review' | 'escalated',
  occurredAt: string,
  eventId: string,
): AgentRuntimeEvent {
  const operation = `crash-recovery:${record.version}`;
  return {
    eventId,
    executionId: record.task.executionId,
    taskId: record.task.taskId,
    correlationId: record.task.correlationId,
    type: 'status_transitioned',
    actor: 'runtime',
    fromStatus: 'in_progress',
    toStatus,
    payload: {
      recoveryReason: 'stale_in_progress_execution',
      previousPersistedAt: record.persistedAt,
      owner: toStatus === 'escalated' ? 'human_executive' : 'operations_agent',
      automaticRetry: false,
    },
    idempotencyKey: runtimeIdempotencyKey('runtime', record.task.executionId, operation),
    occurredAt,
  };
}

async function commitRecoveryMutation(
  store: AgentRuntimeStore,
  previous: AgentRuntimeExecutionRecord,
  next: AgentRuntimeExecutionRecord,
  event: AgentRuntimeEvent,
): Promise<void> {
  const idempotencyRecord = recordRuntimeIdempotency(event, event.type);
  if (store.commitRuntimeMutation) {
    await store.commitRuntimeMutation({ record: next, expectedVersion: previous.version, event, idempotencyRecord });
    return;
  }

  await store.saveExecution(next, previous.version);
  await store.appendEvent(event);
  await store.saveIdempotencyRecord(idempotencyRecord);
}

export async function recoverStaleRuntimeExecutions(
  store: AgentRuntimeStore,
  options: RuntimeRecoveryOptions,
): Promise<readonly RuntimeRecoveryDecision[]> {
  if (!Number.isFinite(options.staleAfterMs) || options.staleAfterMs <= 0) {
    throw new Error('staleAfterMs must be greater than zero.');
  }
  const limit = options.limit ?? 100;
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
    throw new Error('recovery limit must be an integer between 1 and 1000.');
  }
  if (!store.listStaleInProgressExecutions) {
    throw new Error('runtime store does not support stale in-progress execution queries.');
  }

  const now = options.now ?? (() => new Date().toISOString());
  const createEventId = options.createEventId ?? (() => crypto.randomUUID());
  const recoveryTime = now();
  const before = new Date(Date.parse(recoveryTime) - options.staleAfterMs).toISOString();
  const staleRecords = await store.listStaleInProgressExecutions(before, limit);
  const decisions: RuntimeRecoveryDecision[] = [];

  for (const candidate of staleRecords) {
    const current = await store.getExecution(candidate.task.executionId);
    if (!current || current.task.status !== 'in_progress' || current.persistedAt >= before) continue;

    const highRisk = current.task.priority === 'critical' || current.task.risks.length > 0;
    const toStatus = highRisk ? 'escalated' : 'review';
    const event = recoveryEvent(current, toStatus, recoveryTime, createEventId());

    if (await store.hasIdempotencyKey(event.idempotencyKey)) {
      decisions.push({ executionId: current.task.executionId, action: 'skipped_duplicate', record: current });
      continue;
    }

    let next = applyRuntimeEvent(current, event);
    next = {
      ...next,
      task: highRisk
        ? {
            ...next.task,
            approvalRequired: true,
            approvalOwner: 'human_executive',
            nextAction: 'human_executive_reconcile_stale_execution',
          }
        : {
            ...next.task,
            approvalRequired: true,
            approvalOwner: 'operations_agent',
            nextAction: 'operations_reconcile_stale_execution_before_retry',
          },
    };

    await commitRecoveryMutation(store, current, next, event);
    decisions.push({ executionId: current.task.executionId, action: highRisk ? 'escalate' : 'review', record: next });
  }

  return decisions;
}
