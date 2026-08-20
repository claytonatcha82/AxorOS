import type { Pool } from 'pg';
import { AgentRuntimeHandlerRegistry } from '../agents/agent-runtime-handlers.js';
import { createAgentRuntimeOrchestrator } from '../agents/agent-runtime-orchestrator.js';
import { SALES_INTERNAL_INTAKE_CAPABILITY, salesInternalIntakeHandler } from '../agents/sales-internal-intake-handler.js';
import { createAgentRuntimePostgresStore } from '../data/agent-runtime-postgres-store.js';
import { createOperationalRepository } from '../data/operational-repository.js';
import { createLeadSalesIntakeActivationService } from './lead-sales-intake-activation-service.js';
import { createSalesOpportunityAssessmentPersistenceService } from './sales-opportunity-assessment-persistence-service.js';
import {
  createSalesOpportunityAssessmentService,
  type SalesOpportunityContext,
} from './sales-opportunity-assessment-service.js';

function required(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${field} is required.`);
  return trimmed;
}

export function createPersistedLeadSalesIntakeRuntime(pool: Pool) {
  const store = createAgentRuntimePostgresStore(pool);
  const commitRuntimeMutation = store.commitRuntimeMutation;
  if (!commitRuntimeMutation) {
    throw new Error('Persisted Sales intake runtime requires atomic runtime mutations.');
  }

  const handlers = new AgentRuntimeHandlerRegistry();
  handlers.register(salesInternalIntakeHandler);

  const orchestrator = createAgentRuntimeOrchestrator({ store, handlers });
  const activation = createLeadSalesIntakeActivationService({
    getExecution: store.getExecution,
    hasIdempotencyKey: store.hasIdempotencyKey,
    commitRuntimeMutation,
  });
  const operationalRepository = createOperationalRepository(pool);
  const opportunityAssessment = createSalesOpportunityAssessmentService();
  const opportunityAssessmentPersistence = createSalesOpportunityAssessmentPersistenceService(
    operationalRepository,
  );

  const commands = {
    async activateIntake(executionId: string) {
      return activation.activate(required(executionId, 'executionId'));
    },

    async processIntake(executionId: string) {
      const normalizedExecutionId = required(executionId, 'executionId');
      const current = await store.getExecution(normalizedExecutionId);
      if (!current) throw new Error(`Sales intake execution ${normalizedExecutionId} was not found.`);
      if (current.task.destinationAgent !== 'sales_agent') {
        throw new Error('Sales intake processing requires Sales Agent destination.');
      }
      if (current.task.status !== 'ready') {
        throw new Error(`Sales intake processing requires ready status; received ${current.task.status}.`);
      }
      if (current.task.inputs.salesIntakeOnly !== true) {
        throw new Error('Sales intake processing requires intake-only authority.');
      }
      if (current.task.inputs.salesDispatchAuthorised !== false || current.task.inputs.outreachAuthorised !== false) {
        throw new Error('Sales intake processing must not authorise Sales dispatch or outreach.');
      }

      return orchestrator.execute({
        executionId: normalizedExecutionId,
        capabilityId: SALES_INTERNAL_INTAKE_CAPABILITY,
      });
    },

    async assessOpportunity(executionId: string, salesContext: SalesOpportunityContext = {}) {
      const normalizedExecutionId = required(executionId, 'executionId');
      const intakeExecution = await store.getExecution(normalizedExecutionId);
      if (!intakeExecution) throw new Error(`Sales intake execution ${normalizedExecutionId} was not found.`);

      const leadId = required(String(intakeExecution.task.context.leadId ?? ''), 'leadId');
      const lead = await operationalRepository.getLeadById(leadId);
      if (!lead) throw new Error(`Lead not found: ${leadId}.`);

      const assessment = opportunityAssessment.assess({
        intakeExecution,
        lead,
        salesContext,
      });
      const record = await opportunityAssessmentPersistence.persist({ assessment });
      return { assessment, record };
    },
  };

  return {
    store,
    handlers,
    orchestrator,
    activation,
    opportunityAssessment,
    opportunityAssessmentPersistence,
    commands,
  };
}

export type PersistedLeadSalesIntakeRuntime = ReturnType<typeof createPersistedLeadSalesIntakeRuntime>;
