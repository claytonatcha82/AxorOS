import { recordRuntimeIdempotency, runtimeIdempotencyKey } from '../agents/agent-runtime-idempotency.js';
import { canTransitionAgentExecution } from '../agents/agent-runtime-lifecycle.js';
import type { AgentRuntimeEvent, AgentRuntimeExecutionRecord } from '../agents/agent-runtime-state.js';
import type { AgentRuntimeStore, RuntimeMutation } from '../agents/agent-runtime-store.js';

export interface LeadSalesIntakeActivationStore
  extends Pick<AgentRuntimeStore, 'getExecution' | 'hasIdempotencyKey'> {
  commitRuntimeMutation(mutation: RuntimeMutation): Promise<void>;
}

export function createLeadSalesIntakeActivationService(
  store: LeadSalesIntakeActivationStore,
  createEventId: () => string = () => crypto.randomUUID(),
  now: () => string = () => new Date().toISOString(),
) {
  return {
    async activate(executionId: string): Promise<AgentRuntimeExecutionRecord> {
      const normalizedExecutionId = executionId.trim();
      if (!normalizedExecutionId) throw new Error('executionId is required.');

      const current = await store.getExecution(normalizedExecutionId);
      if (!current) throw new Error(`Sales intake execution ${normalizedExecutionId} was not found.`);
      if (current.task.destinationAgent !== 'sales_agent') throw new Error('Sales intake activation requires Sales Agent destination.');
      if (current.task.status !== 'queued') throw new Error(`Sales intake activation requires queued status; received ${current.task.status}.`);
      if (current.task.inputs.salesIntakeOnly !== true) throw new Error('Sales intake activation requires intake-only authority.');
      if (current.task.inputs.salesDispatchAuthorised !== false || current.task.inputs.outreachAuthorised !== false) {
        throw new Error('Sales intake activation must not authorise Sales dispatch or outreach.');
      }
      if (!canTransitionAgentExecution(current.task.status, 'ready')) throw new Error('Queued Sales intake cannot transition to ready.');

      const operation = 'sales-intake-ready';
      const idempotencyKey = runtimeIdempotencyKey('runtime', normalizedExecutionId, operation);
      if (await store.hasIdempotencyKey(idempotencyKey)) {
        const replay = await store.getExecution(normalizedExecutionId);
        if (!replay) throw new Error('Sales intake activation idempotency record exists but execution is missing.');
        return replay;
      }

      const occurredAt = now();
      const event: AgentRuntimeEvent = {
        eventId: createEventId(),
        executionId: current.task.executionId,
        taskId: current.task.taskId,
        correlationId: current.task.correlationId,
        type: 'status_transitioned',
        actor: 'runtime',
        fromStatus: 'queued',
        toStatus: 'ready',
        payload: { capabilityId: 'sales_internal_intake', outreachAuthorised: false },
        idempotencyKey,
        occurredAt,
      };
      const record: AgentRuntimeExecutionRecord = {
        ...current,
        task: { ...current.task, status: 'ready', nextAction: 'execute_internal_sales_intake', updatedAt: occurredAt },
        version: current.version + 1,
        lastEventId: event.eventId,
        persistedAt: occurredAt,
      };

      await store.commitRuntimeMutation({
        record,
        expectedVersion: current.version,
        event,
        idempotencyRecord: recordRuntimeIdempotency(event, operation),
      });
      return record;
    },
  };
}

export type LeadSalesIntakeActivationService = ReturnType<typeof createLeadSalesIntakeActivationService>;
