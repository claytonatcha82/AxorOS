import type { Pool } from 'pg';
import { AgentRuntimeHandlerRegistry } from '../agents/agent-runtime-handlers.js';
import { createAgentRuntimeOrchestrator } from '../agents/agent-runtime-orchestrator.js';
import { createAgentRuntimePostgresStore } from '../data/agent-runtime-postgres-store.js';
import { createOperationalRepository } from '../data/operational-repository.js';
import { createLeadQualificationRuntimeReviewRegistrationService } from './lead-qualification-runtime-review-registration-service.js';
import { createLeadQualificationRuntimeReviewService } from './lead-qualification-runtime-review-service.js';
import { createLeadSalesHandoffEligibilityPersistenceService } from './lead-sales-handoff-eligibility-persistence-service.js';
import { createLeadSalesHandoffEligibilityService } from './lead-sales-handoff-eligibility-service.js';
import { createLeadSalesIntakeRegistrationService } from './lead-sales-intake-registration-service.js';
import { createLeadSalesIntakeTaskService } from './lead-sales-intake-task-service.js';

const LEAD_QUALIFICATION_REVIEW_GATE_CAPABILITY = 'lead_qualification_human_review_gate';

export type LeadQualificationReviewDecision = 'approved' | 'rejected';

function required(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${field} is required.`);
  return trimmed;
}

export function createPersistedLeadQualificationRuntimeReview(pool: Pool) {
  const store = createAgentRuntimePostgresStore(pool);
  const commitRuntimeMutation = store.commitRuntimeMutation;
  if (!commitRuntimeMutation) {
    throw new Error('Persisted Lead qualification review runtime requires atomic runtime mutations.');
  }

  const handlers = new AgentRuntimeHandlerRegistry();
  const orchestrator = createAgentRuntimeOrchestrator({ store, handlers });
  const taskService = createLeadQualificationRuntimeReviewService();
  const registrationStore = {
    getExecution: store.getExecution,
    hasIdempotencyKey: store.hasIdempotencyKey,
    commitRuntimeMutation,
  };
  const registration = createLeadQualificationRuntimeReviewRegistrationService({ store: registrationStore });
  const handoffEligibility = createLeadSalesHandoffEligibilityService(store);
  const operationalRepository = createOperationalRepository(pool);
  const handoffEligibilityPersistence = createLeadSalesHandoffEligibilityPersistenceService(operationalRepository);
  const salesIntakeTaskService = createLeadSalesIntakeTaskService();
  const salesIntakeRegistration = createLeadSalesIntakeRegistrationService({ store: registrationStore });

  const commands = {
    async requestReview(executionId: string) {
      const normalizedExecutionId = required(executionId, 'executionId');
      const record = await store.getExecution(normalizedExecutionId);
      if (!record) throw new Error(`Lead qualification review execution ${normalizedExecutionId} was not found.`);
      if (record.task.destinationAgent !== 'lead_agent') {
        throw new Error('Lead qualification review command requires Lead Agent destination.');
      }
      if (record.task.approvalRequired !== true || record.task.approvalOwner !== 'human_executive') {
        throw new Error('Lead qualification review command requires pending human executive approval.');
      }
      if (record.task.nextAction !== 'obtain_required_approval') {
        throw new Error('Lead qualification review command requires the governed approval route.');
      }

      return orchestrator.execute({
        executionId: normalizedExecutionId,
        capabilityId: LEAD_QUALIFICATION_REVIEW_GATE_CAPABILITY,
      });
    },

    async resolveReview(executionId: string, decision: LeadQualificationReviewDecision, reason?: string) {
      const normalizedExecutionId = required(executionId, 'executionId');
      const record = await store.getExecution(normalizedExecutionId);
      if (!record) throw new Error(`Lead qualification review execution ${normalizedExecutionId} was not found.`);
      if (record.task.destinationAgent !== 'lead_agent') {
        throw new Error('Lead qualification review resolution requires Lead Agent destination.');
      }
      if (record.task.status !== 'review') {
        throw new Error(`Lead qualification review resolution requires review status; received ${record.task.status}.`);
      }
      if (record.task.approvalRequired !== true || record.task.approvalOwner !== 'human_executive') {
        throw new Error('Lead qualification review resolution requires human executive approval authority.');
      }

      const outcome = await orchestrator.resolveApproval({
        executionId: normalizedExecutionId,
        actor: 'human_executive',
        decision,
        ...(reason?.trim() ? { reason: reason.trim() } : {}),
      });

      if (decision === 'approved' && record.task.inputs.recommendedAction === 'approve_advance') {
        const eligibility = await handoffEligibility.evaluate(normalizedExecutionId);
        const persistedEligibility = await handoffEligibilityPersistence.persist({ eligibility });
        const salesIntakeTask = salesIntakeTaskService.createTask({
          taskId: `sales-intake-task:${persistedEligibility.id}`,
          executionId: `sales-intake:${persistedEligibility.id}`,
          correlationId: record.task.correlationId,
          eligibilityRecordId: persistedEligibility.id,
          eligibility,
          createdAt: persistedEligibility.createdAt,
        });
        await salesIntakeRegistration.register(salesIntakeTask);
      }

      return outcome;
    },
  };

  return {
    store,
    taskService,
    registration,
    handoffEligibility,
    handoffEligibilityPersistence,
    salesIntakeTaskService,
    salesIntakeRegistration,
    commands,
  };
}

export type PersistedLeadQualificationRuntimeReview = ReturnType<
  typeof createPersistedLeadQualificationRuntimeReview
>;
