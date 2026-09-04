import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { AgentRuntimeHandlerRegistry } from '../agents/agent-runtime-handlers.js';
import { createAgentRuntimeOrchestrator } from '../agents/agent-runtime-orchestrator.js';
import { validateAgentRuntimeTask, type AgentRuntimeTask } from '../agents/agent-runtime-contract.js';
import { recordRuntimeIdempotency, runtimeIdempotencyKey } from '../agents/agent-runtime-idempotency.js';
import type { AgentRuntimeEvent, AgentRuntimeExecutionRecord } from '../agents/agent-runtime-state.js';
import { SALES_INTERNAL_INTAKE_CAPABILITY, salesInternalIntakeHandler } from '../agents/sales-internal-intake-handler.js';
import { createAgentRuntimePostgresStore } from '../data/agent-runtime-postgres-store.js';
import { createOperationalRepository } from '../data/operational-repository.js';
import { createLeadSalesIntakeActivationService } from './lead-sales-intake-activation-service.js';
import { createSalesOpportunityAssessmentPersistenceService } from './sales-opportunity-assessment-persistence-service.js';
import { createSalesOpportunityDecisionPersistenceService } from './sales-opportunity-decision-persistence-service.js';
import { createSalesOpportunityDecisionService, type SalesOpportunityDecisionResult } from './sales-opportunity-decision-service.js';
import { createSalesGovernedOutreachPreparationService } from './sales-governed-outreach-preparation-service.js';
import { createSalesOutreachApprovalPersistenceService } from './sales-outreach-approval-persistence-service.js';
import { createSalesOutreachApprovalResolutionPersistenceService } from './sales-outreach-approval-resolution-persistence-service.js';
import { createSalesOutreachApprovalResolutionService } from './sales-outreach-approval-resolution-service.js';
import { createSalesOutreachApprovalService } from './sales-outreach-approval-service.js';
import { createSalesOpportunityAssessmentService, type SalesOpportunityContext } from './sales-opportunity-assessment-service.js';

function required(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${field} is required.`);
  return trimmed;
}

export interface AutoAdvanceSalesIntakeInput {
  leadId: string;
  qualificationRecordId: string;
  dispositionRecordId: string;
  atlasSourcePaths: string[];
  correlationId: string;
  createdAt: string;
}

export function createPersistedLeadSalesIntakeRuntime(pool: Pool) {
  const store = createAgentRuntimePostgresStore(pool);
  const commitRuntimeMutation = store.commitRuntimeMutation;
  if (!commitRuntimeMutation) throw new Error('Persisted Sales intake runtime requires atomic runtime mutations.');

  const handlers = new AgentRuntimeHandlerRegistry();
  handlers.register(salesInternalIntakeHandler);
  const orchestrator = createAgentRuntimeOrchestrator({ store, handlers });
  const activation = createLeadSalesIntakeActivationService({ getExecution: store.getExecution, hasIdempotencyKey: store.hasIdempotencyKey, commitRuntimeMutation });
  const operationalRepository = createOperationalRepository(pool);
  const opportunityAssessment = createSalesOpportunityAssessmentService();
  const opportunityAssessmentPersistence = createSalesOpportunityAssessmentPersistenceService(operationalRepository);
  const opportunityDecision = createSalesOpportunityDecisionService();
  const opportunityDecisionPersistence = createSalesOpportunityDecisionPersistenceService(operationalRepository);
  const outreachApproval = createSalesOutreachApprovalService();
  const outreachApprovalPersistence = createSalesOutreachApprovalPersistenceService(operationalRepository);
  const outreachApprovalResolution = createSalesOutreachApprovalResolutionService();
  const outreachApprovalResolutionPersistence = createSalesOutreachApprovalResolutionPersistenceService(operationalRepository);
  const governedOutreachPreparation = createSalesGovernedOutreachPreparationService(operationalRepository);

  const registerAutoAdvanceIntake = async (input: AutoAdvanceSalesIntakeInput): Promise<AgentRuntimeExecutionRecord> => {
    const leadId = required(input.leadId, 'leadId');
    const qualificationRecordId = required(input.qualificationRecordId, 'qualificationRecordId');
    const dispositionRecordId = required(input.dispositionRecordId, 'dispositionRecordId');
    const correlationId = required(input.correlationId, 'correlationId');
    const createdAt = required(input.createdAt, 'createdAt');
    const atlasSourcePaths = [...new Set(input.atlasSourcePaths.map((path) => path.trim()).filter(Boolean))];
    if (atlasSourcePaths.length === 0) throw new Error('Auto-advanced Sales intake requires authoritative Atlas source paths.');

    const executionId = `sales-intake:auto-advance:${dispositionRecordId}`;
    const taskId = `sales-intake-task:auto-advance:${dispositionRecordId}`;
    const existing = await store.getExecution(executionId);
    if (existing) return existing;

    const task: AgentRuntimeTask = {
      taskId, executionId, originAgent: 'lead_agent', destinationAgent: 'sales_agent',
      objective: 'Intake an auto-advanced qualified lead for internal Sales processing without contacting the prospect.',
      priority: 'normal',
      context: { leadId, qualificationRecordId, dispositionRecordId, authorizationBasis: 'lead_auto_advance' },
      knowledgeReferences: atlasSourcePaths,
      inputs: { leadId, qualificationRecordId, dispositionRecordId, authorizationBasis: 'lead_auto_advance', salesIntakeOnly: true, salesDispatchAuthorised: false, outreachAuthorised: false },
      expectedOutput: 'A governed internal Sales intake assessment with no prospect contact or outreach.',
      dependencies: [], risks: [], confidence: 1, approvalRequired: false,
      status: 'queued', nextAction: 'configure_governed_sales_intake_processing', attempt: 1, maxAttempts: 1,
      correlationId, createdAt, updatedAt: createdAt,
    };
    const errors = validateAgentRuntimeTask(task);
    if (errors.length) throw new Error(errors.join(' '));
    const operation = 'task_created';
    const idempotencyKey = runtimeIdempotencyKey('runtime', executionId, operation);
    if (await store.hasIdempotencyKey(idempotencyKey)) {
      const replay = await store.getExecution(executionId);
      if (!replay) throw new Error('Sales auto-advance idempotency record exists but execution state is missing.');
      return replay;
    }
    const eventId = randomUUID();
    const event: AgentRuntimeEvent = {
      eventId, executionId, taskId, correlationId, type: 'task_created', actor: 'runtime',
      payload: { originAgent: 'lead_agent', destinationAgent: 'sales_agent', authorizationBasis: 'lead_auto_advance', salesIntakeOnly: true, salesDispatchAuthorised: false, outreachAuthorised: false },
      idempotencyKey, occurredAt: createdAt,
    };
    const record: AgentRuntimeExecutionRecord = { task, version: 1, lastEventId: eventId, persistedAt: createdAt };
    await commitRuntimeMutation({ record, expectedVersion: 0, event, idempotencyRecord: recordRuntimeIdempotency(event, operation) });
    return record;
  };

  const commands = {
    async activateIntake(executionId: string) { return activation.activate(required(executionId, 'executionId')); },

    async processIntake(executionId: string) {
      const normalizedExecutionId = required(executionId, 'executionId');
      const current = await store.getExecution(normalizedExecutionId);
      if (!current) throw new Error(`Sales intake execution ${normalizedExecutionId} was not found.`);
      if (current.task.destinationAgent !== 'sales_agent') throw new Error('Sales intake processing requires Sales Agent destination.');
      if (current.task.status !== 'ready') throw new Error(`Sales intake processing requires ready status; received ${current.task.status}.`);
      if (current.task.inputs.salesIntakeOnly !== true) throw new Error('Sales intake processing requires intake-only authority.');
      if (current.task.inputs.salesDispatchAuthorised !== false || current.task.inputs.outreachAuthorised !== false) throw new Error('Sales intake processing must not authorise Sales dispatch or outreach.');
      return orchestrator.execute({ executionId: normalizedExecutionId, capabilityId: SALES_INTERNAL_INTAKE_CAPABILITY });
    },

    async handoffAutoAdvancedLead(input: AutoAdvanceSalesIntakeInput) {
      const record = await registerAutoAdvanceIntake(input);
      const ready = record.task.status === 'queued' ? await activation.activate(record.task.executionId) : record;
      const result = ready.task.status === 'ready' ? await orchestrator.execute({ executionId: ready.task.executionId, capabilityId: SALES_INTERNAL_INTAKE_CAPABILITY }) : ready;
      return { intakeExecution: result };
    },

    async assessOpportunity(executionId: string, salesContext: SalesOpportunityContext = {}) {
      const normalizedExecutionId = required(executionId, 'executionId');
      const intakeExecution = await store.getExecution(normalizedExecutionId);
      if (!intakeExecution) throw new Error(`Sales intake execution ${normalizedExecutionId} was not found.`);
      const leadId = required(String(intakeExecution.task.context.leadId ?? ''), 'leadId');
      const lead = await operationalRepository.getLeadById(leadId);
      if (!lead) throw new Error(`Lead not found: ${leadId}.`);
      const assessment = opportunityAssessment.assess({ intakeExecution, lead, salesContext });
      const record = await opportunityAssessmentPersistence.persist({ assessment });
      return { assessment, record };
    },

    async decideOpportunity(executionId: string, salesContext: SalesOpportunityContext = {}) {
      const assessmentResult = await commands.assessOpportunity(executionId, salesContext);
      const decision = opportunityDecision.decide(assessmentResult.assessment);
      const record = await opportunityDecisionPersistence.persist({ decision });
      return { assessment: assessmentResult.assessment, assessmentRecord: assessmentResult.record, decision, decisionRecord: record };
    },

    async requestOutreachApproval(executionId: string, salesContext: SalesOpportunityContext = {}) {
      const decisionResult = await commands.decideOpportunity(executionId, salesContext);
      const request = outreachApproval.request(decisionResult.decision);
      const record = await outreachApprovalPersistence.persist({ request });
      return { ...decisionResult, outreachApprovalRequest: request, outreachApprovalRecord: record };
    },

    async resolveOutreachApproval(input: {
      approvalRecordId: string;
      decision: SalesOpportunityDecisionResult;
      decisionOutcome: 'approved' | 'denied';
      actor: string;
      reason?: string;
    }) {
      const approvalRecordId = required(input.approvalRecordId, 'approvalRecordId');
      const approvalRecord = await operationalRepository.getWorkflowEventById(approvalRecordId);
      if (!approvalRecord) throw new Error(`Sales outreach approval record ${approvalRecordId} was not found.`);
      const request = outreachApproval.request(input.decision);
      const resolutionInput = {
        decision: input.decision,
        request,
        approvalRecord,
        actor: input.actor,
        decisionOutcome: input.decisionOutcome,
        ...(input.reason !== undefined ? { reason: input.reason } : {}),
      };
      const resolution = outreachApprovalResolution.resolve(resolutionInput);
      const record = await outreachApprovalResolutionPersistence.persist({ resolution });
      return { approvalRequest: request, approvalRecord, resolution, resolutionRecord: record };
    },

    async prepareApprovedOutreach(input: { resolutionRecordId: string; subject: string; body: string }) {
      return governedOutreachPreparation.prepare(input);
    },
  };

  return { store, handlers, orchestrator, activation, opportunityAssessment, opportunityAssessmentPersistence, opportunityDecision, opportunityDecisionPersistence, outreachApproval, outreachApprovalPersistence, outreachApprovalResolution, outreachApprovalResolutionPersistence, governedOutreachPreparation, commands };
}

export type PersistedLeadSalesIntakeRuntime = ReturnType<typeof createPersistedLeadSalesIntakeRuntime>;
