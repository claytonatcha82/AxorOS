import { validateAgentRuntimeTask, type AgentRuntimeTask } from '../agents/agent-runtime-contract.js';
import { recordRuntimeIdempotency, runtimeIdempotencyKey } from '../agents/agent-runtime-idempotency.js';
import type { AgentRuntimeExecutionRecord, AgentRuntimeEvent } from '../agents/agent-runtime-state.js';
import type { AgentRuntimeStore, RuntimeMutation } from '../agents/agent-runtime-store.js';

export interface LeadQualificationRuntimeReviewRegistrationStore
  extends Pick<AgentRuntimeStore, 'getExecution' | 'hasIdempotencyKey'> {
  commitRuntimeMutation(mutation: RuntimeMutation): Promise<void>;
}

export interface LeadQualificationRuntimeReviewRegistrationDependencies {
  store: LeadQualificationRuntimeReviewRegistrationStore;
  createEventId?: () => string;
}

export function createLeadQualificationRuntimeReviewRegistrationService(
  dependencies: LeadQualificationRuntimeReviewRegistrationDependencies,
) {
  const createEventId = dependencies.createEventId ?? (() => crypto.randomUUID());

  return {
    async register(task: AgentRuntimeTask): Promise<AgentRuntimeExecutionRecord> {
      const errors = validateAgentRuntimeTask(task);
      if (errors.length) throw new Error(errors.join(' '));
      if (task.destinationAgent !== 'lead_agent') {
        throw new Error('Lead qualification runtime review registration requires Lead Agent destination.');
      }
      if (task.approvalRequired !== true || task.approvalOwner !== 'human_executive') {
        throw new Error('Lead qualification runtime review registration must preserve human executive approval authority.');
      }
      if (task.nextAction !== 'obtain_required_approval') {
        throw new Error('Lead qualification runtime review registration requires the governed approval route.');
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
        if (!replay) throw new Error('Runtime task creation idempotency record exists but execution state is missing.');
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
          destinationAgent: task.destinationAgent,
          approvalRequired: true,
          approvalOwner: 'human_executive',
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

export type LeadQualificationRuntimeReviewRegistrationService = ReturnType<
  typeof createLeadQualificationRuntimeReviewRegistrationService
>;
