import { validateAgentRuntimeTask, type AgentRuntimeTask } from '../agents/agent-runtime-contract.js';
import { recordRuntimeIdempotency, runtimeIdempotencyKey } from '../agents/agent-runtime-idempotency.js';
import type { AgentRuntimeExecutionRecord, AgentRuntimeEvent } from '../agents/agent-runtime-state.js';
import type { AgentRuntimeStore, RuntimeMutation } from '../agents/agent-runtime-store.js';

export interface LeadSalesIntakeRegistrationStore
  extends Pick<AgentRuntimeStore, 'getExecution' | 'hasIdempotencyKey'> {
  commitRuntimeMutation(mutation: RuntimeMutation): Promise<void>;
}

export interface LeadSalesIntakeRegistrationDependencies {
  store: LeadSalesIntakeRegistrationStore;
  createEventId?: () => string;
}

export function createLeadSalesIntakeRegistrationService(
  dependencies: LeadSalesIntakeRegistrationDependencies,
) {
  const createEventId = dependencies.createEventId ?? (() => crypto.randomUUID());

  return {
    async register(task: AgentRuntimeTask): Promise<AgentRuntimeExecutionRecord> {
      const errors = validateAgentRuntimeTask(task);
      if (errors.length) throw new Error(errors.join(' '));
      if (task.originAgent !== 'lead_agent' || task.destinationAgent !== 'sales_agent') {
        throw new Error('Sales intake registration requires a Lead Agent to Sales Agent task.');
      }
      if (task.status !== 'queued') {
        throw new Error('Sales intake registration requires queued status.');
      }
      if (task.nextAction !== 'configure_governed_sales_intake_processing') {
        throw new Error('Sales intake registration requires the governed intake configuration route.');
      }
      if (task.inputs.salesIntakeOnly !== true) {
        throw new Error('Sales intake registration requires intake-only scope.');
      }
      if (task.inputs.salesDispatchAuthorised !== false || task.inputs.outreachAuthorised !== false) {
        throw new Error('Sales intake registration must not authorise Sales dispatch or prospect outreach.');
      }

      const existing = await dependencies.store.getExecution(task.executionId);
      if (existing) {
        if (existing.task.taskId !== task.taskId) {
          throw new Error(`Runtime execution ${task.executionId} already exists for a different task.`);
        }
        return existing;
      }

      const idempotencyKey = runtimeIdempotencyKey('runtime', task.executionId, 'task_created');
      if (await dependencies.store.hasIdempotencyKey(idempotencyKey)) {
        const replay = await dependencies.store.getExecution(task.executionId);
        if (!replay) throw new Error('Sales intake idempotency record exists but execution state is missing.');
        return replay;
      }

      const eventId = createEventId();
      const created: AgentRuntimeEvent = {
        eventId,
        executionId: task.executionId,
        taskId: task.taskId,
        correlationId: task.correlationId,
        type: 'task_created',
        actor: 'runtime',
        payload: {
          originAgent: 'lead_agent',
          destinationAgent: 'sales_agent',
          salesIntakeOnly: true,
          salesDispatchAuthorised: false,
          outreachAuthorised: false,
        },
        idempotencyKey,
        occurredAt: task.createdAt,
      };
      const record: AgentRuntimeExecutionRecord = {
        task,
        version: 1,
        lastEventId: eventId,
        persistedAt: task.createdAt,
      };

      await dependencies.store.commitRuntimeMutation({
        record,
        expectedVersion: 0,
        event: created,
        idempotencyRecord: recordRuntimeIdempotency(created, 'task_created'),
      });
      return record;
    },
  };
}

export type LeadSalesIntakeRegistrationService = ReturnType<
  typeof createLeadSalesIntakeRegistrationService
>;
