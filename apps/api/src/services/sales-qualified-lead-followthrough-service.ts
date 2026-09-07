import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { AgentRuntimeHandlerRegistry } from '../agents/agent-runtime-handlers.js';
import { createAgentRuntimeOrchestrator } from '../agents/agent-runtime-orchestrator.js';
import { validateAgentRuntimeTask, type AgentRuntimeTask } from '../agents/agent-runtime-contract.js';
import { recordRuntimeIdempotency, runtimeIdempotencyKey } from '../agents/agent-runtime-idempotency.js';
import type { AgentRuntimeEvent, AgentRuntimeExecutionRecord } from '../agents/agent-runtime-state.js';
import { createAgentRuntimePostgresStore } from '../data/agent-runtime-postgres-store.js';
import { createOperationalRepository } from '../data/operational-repository.js';
import type { IntegrationRegistry } from '../integrations/integration-registry.js';
import type { PublicWebSearchResult } from '../integrations/public-web-research-integration.js';
import { registerModelRuntimeCapability } from '../agents/model-runtime-registration.js';
import type { SalesOpportunityContext } from './sales-opportunity-assessment-service.js';
import { createSalesMissingContextRetrievalService } from './sales-missing-context-retrieval-service.js';
import { createSalesOutreachPreparationEligibilityService } from './sales-outreach-preparation-eligibility-service.js';
import { createSalesInternalOutreachDraftService } from './sales-internal-outreach-draft-service.js';
import { createSalesOpportunityAssessmentService } from './sales-opportunity-assessment-service.js';
import { createSalesOpportunityAssessmentPersistenceService } from './sales-opportunity-assessment-persistence-service.js';

const SALES_QUALIFIED_LEAD_FOLLOWTHROUGH_CAPABILITY = 'sales_qualified_lead_followthrough';

interface GeneratedFollowthrough {
  salesContext: SalesOpportunityContext;
  email: { subject: string; body: string };
}

function required(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${field} is required.`);
  return trimmed;
}

export function parseGeneratedOutput(text: string): GeneratedFollowthrough {
  const trimmed = text.trim();
  const candidate = trimmed.startsWith('```')
    ? trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
    : trimmed;
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    throw new Error('Sales followthrough model returned invalid JSON.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Sales followthrough model returned an invalid object.');
  const value = parsed as Record<string, unknown>;
  const context = value.salesContext;
  const email = value.email;
  if (!context || typeof context !== 'object' || Array.isArray(context)) throw new Error('Sales followthrough model omitted salesContext.');
  if (!email || typeof email !== 'object' || Array.isArray(email)) throw new Error('Sales followthrough model omitted email draft.');
  const emailValue = email as Record<string, unknown>;
  const subject = typeof emailValue.subject === 'string' ? emailValue.subject.trim() : '';
  const body = typeof emailValue.body === 'string' ? emailValue.body.trim() : '';
  if (!subject || !body) throw new Error('Sales followthrough model returned incomplete email draft.');
  return { salesContext: context as SalesOpportunityContext, email: { subject, body } };
}

export function buildSalesFollowthroughTask(input: {
  executionId: string;
  leadId: string;
  correlationId: string;
  atlasSourcePaths: string[];
  lead: unknown;
  qualification: unknown;
  intakeResult: unknown;
  createdAt: string;
  researchEvidence?: PublicWebSearchResult[];
}): AgentRuntimeTask {
  const task: AgentRuntimeTask = {
    taskId: `sales-followthrough-task:${input.executionId}`,
    executionId: input.executionId,
    originAgent: 'lead_agent',
    destinationAgent: 'sales_agent',
    objective: 'Use persisted qualified-lead evidence to perform internal Sales opportunity assessment and prepare an outreach email draft for human review only.',
    priority: 'normal',
    context: { leadId: input.leadId, dataClass: 'qualified_lead_evidence', intakeExecutionId: input.executionId },
    knowledgeReferences: [...new Set(input.atlasSourcePaths)],
    inputs: {
      salesBrief: 'Return strict JSON containing salesContext and an email subject/body. Use only supplied persisted evidence and Atlas references.',
      salesContext: JSON.stringify({
        lead: input.lead,
        qualification: input.qualification,
        intakeResult: input.intakeResult,
        ...(input.researchEvidence?.length ? { additionalPublicWebEvidence: input.researchEvidence } : {}),
      }),
      salesIntakeOnly: true,
      salesDispatchAuthorised: false,
      outreachAuthorised: false,
    },
    expectedOutput: 'Evidence-backed Sales context and internal outreach email draft requiring human review.',
    dependencies: [],
    risks: ['Model output must not invent unsupported lead facts, commercial terms, pricing, commitments, or approvals.'],
    confidence: 1,
    approvalRequired: false,
    status: 'ready',
    nextAction: 'execute_qualified_lead_sales_followthrough',
    attempt: 1,
    maxAttempts: 1,
    correlationId: input.correlationId,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  };
  const errors = validateAgentRuntimeTask(task);
  if (errors.length) throw new Error(errors.join(' '));
  return task;
}

export function createSalesQualifiedLeadFollowthroughService(pool: Pool, integrations: IntegrationRegistry) {
  const store = createAgentRuntimePostgresStore(pool);
  const commitRuntimeMutation = store.commitRuntimeMutation;
  if (!commitRuntimeMutation) throw new Error('Sales qualified lead followthrough requires atomic runtime mutations.');

  const operationalRepository = createOperationalRepository(pool);
  const assessmentService = createSalesOpportunityAssessmentService();
  const assessmentPersistence = createSalesOpportunityAssessmentPersistenceService(operationalRepository);
  const preparationEligibility = createSalesOutreachPreparationEligibilityService(operationalRepository);
  const internalDraft = createSalesInternalOutreachDraftService(operationalRepository);
  const missingContextRetrieval = createSalesMissingContextRetrievalService(integrations);
  const handlers = new AgentRuntimeHandlerRegistry();
  const modelIntegrationId = integrations.get('model.gemini') ? 'model.gemini' : 'model.sandbox';
  registerModelRuntimeCapability(handlers, integrations, {
    agentId: 'sales_agent',
    capabilityId: SALES_QUALIFIED_LEAD_FOLLOWTHROUGH_CAPABILITY,
    integrationId: modelIntegrationId,
    mode: 'draft',
    promptInputKey: 'salesBrief',
    contextInputKey: 'salesContext',
    systemInstruction: [
      'You are the AxorOS Sales Agent operating in governed internal draft mode.',
      'Return JSON only with keys salesContext and email.',
      'Use only facts explicitly present in the supplied persisted lead, qualification, intake result, additional public-web evidence, or Atlas references.',
      'Never invent a decision maker, industry, country, business summary, website audit, pain point, recommended service, priority, confidence, previous contact status, pricing, discount, budget, contract term, delivery promise, or approval.',
      'If the evidence does not support a required sales context field, leave it absent so the downstream assessment fails closed rather than guessing.',
      'The email is an internal candidate draft for human review; do not send it and do not imply outreach authority.',
      'Do not include prices or commercial commitments unless explicitly present in the supplied evidence.',
    ].join(' '),
    maxOutputTokens: 1200,
    temperature: 0.2,
  });
  const orchestrator = createAgentRuntimeOrchestrator({ store, handlers });

  async function ensureModelExecution(input: {
    executionId: string;
    intake: AgentRuntimeExecutionRecord;
    lead: Awaited<ReturnType<typeof operationalRepository.getLeadById>>;
    qualification: unknown;
    researchEvidence?: PublicWebSearchResult[];
  }): Promise<AgentRuntimeExecutionRecord> {
    if (!input.lead) throw new Error('Sales followthrough lead is required.');
    let modelExecution = await store.getExecution(input.executionId);
    if (!modelExecution) {
      const task = buildSalesFollowthroughTask({
        executionId: input.executionId,
        leadId: input.lead.id,
        correlationId: input.intake.task.correlationId,
        atlasSourcePaths: input.intake.task.knowledgeReferences,
        lead: input.lead,
        qualification: input.qualification,
        intakeResult: input.intake.result?.output ?? {},
        createdAt: new Date().toISOString(),
        ...(input.researchEvidence ? { researchEvidence: input.researchEvidence } : {}),
      });
      const idempotencyKey = runtimeIdempotencyKey('runtime', input.executionId, 'task_created');
      if (await store.hasIdempotencyKey(idempotencyKey)) {
        modelExecution = await store.getExecution(input.executionId);
      } else {
        const event: AgentRuntimeEvent = {
          eventId: randomUUID(), executionId: input.executionId, taskId: task.taskId, correlationId: task.correlationId,
          type: 'task_created', actor: 'runtime',
          payload: { originAgent: 'lead_agent', destinationAgent: 'sales_agent', salesIntakeOnly: true, salesDispatchAuthorised: false, outreachAuthorised: false },
          idempotencyKey, occurredAt: task.createdAt,
        };
        const record: AgentRuntimeExecutionRecord = { task, version: 1, lastEventId: event.eventId, persistedAt: task.createdAt };
        await commitRuntimeMutation({ record, expectedVersion: 0, event, idempotencyRecord: recordRuntimeIdempotency(event, 'task_created') });
        modelExecution = record;
      }
    }
    if (!modelExecution) throw new Error(`Sales followthrough execution ${input.executionId} could not be created.`);
    if (modelExecution.task.status === 'completed' && modelExecution.result?.status === 'completed') return modelExecution;
    return (await orchestrator.execute({ executionId: input.executionId, capabilityId: SALES_QUALIFIED_LEAD_FOLLOWTHROUGH_CAPABILITY })).record;
  }

  return {
    store,
    async executeAfterIntake(intakeExecutionId: string) {
      const intake = await store.getExecution(required(intakeExecutionId, 'intakeExecutionId'));
      if (!intake) throw new Error(`Sales intake execution ${intakeExecutionId} was not found.`);
      if (intake.task.destinationAgent !== 'sales_agent') throw new Error('Sales followthrough requires Sales Agent destination.');
      if (intake.task.status !== 'completed' || intake.result?.status !== 'completed') throw new Error('Sales followthrough requires a completed internal Sales intake.');
      if (intake.task.inputs.salesIntakeOnly !== true || intake.task.inputs.salesDispatchAuthorised !== false || intake.task.inputs.outreachAuthorised !== false) {
        throw new Error('Sales followthrough requires intake-only authority.');
      }
      const leadId = required(String(intake.task.context.leadId ?? ''), 'leadId');
      const lead = await operationalRepository.getLeadById(leadId);
      if (!lead) throw new Error(`Lead not found: ${leadId}.`);
      const qualifications = await operationalRepository.listPreliminaryLeadQualifications(leadId);
      const qualification = qualifications[0] ?? null;
      if (!qualification) throw new Error(`Lead qualification record not found for ${leadId}.`);

      const executionId = `sales-followthrough:${intakeExecutionId}`;
      const generated = await ensureModelExecution({ executionId, intake, lead, qualification });
      if (generated.task.status !== 'completed' || generated.result?.status !== 'completed') throw new Error('Sales followthrough model execution did not complete.');
      const followthrough = parseGeneratedOutput(String(generated.result?.output.text ?? ''));
      const assessment = assessmentService.assess({ intakeExecution: intake, lead, salesContext: followthrough.salesContext });
      const assessmentRecord = await assessmentPersistence.persist({ assessment });

      if (assessment.assessmentStatus !== 'context_complete') {
        const retrieval = await missingContextRetrieval.retrieve({
          lead,
          missingFields: assessment.missingInformation,
          executionId,
          correlationId: intake.task.correlationId,
          country: assessment.salesContext.country,
        });
        await operationalRepository.createWorkflowEvent({
          eventType: 'sales_missing_context_retrieval_recorded',
          actorType: 'agent',
          actorId: 'sales_agent',
          payload: {
            leadId: retrieval.leadId,
            missingFields: retrieval.missingFields,
            searchesRun: retrieval.searchesRun,
            evidenceCount: retrieval.evidence.length,
            evidenceReferences: retrieval.evidence.map((item) => `public-web:${item.url}`),
            nextAction: retrieval.nextAction,
          },
        });

        const reassessmentExecutionId = `${executionId}:context-retrieval`;
        const reassessedModel = await ensureModelExecution({
          executionId: reassessmentExecutionId,
          intake,
          lead,
          qualification,
          researchEvidence: retrieval.evidence,
        });
        if (reassessedModel.task.status !== 'completed' || reassessedModel.result?.status !== 'completed') {
          throw new Error('Sales missing-context reassessment model execution did not complete.');
        }
        const reassessedFollowthrough = parseGeneratedOutput(String(reassessedModel.result?.output.text ?? ''));
        const reassessed = assessmentService.assess({ intakeExecution: intake, lead, salesContext: reassessedFollowthrough.salesContext });
        const reassessedRecord = await assessmentPersistence.persist({ assessment: reassessed });
        if (reassessed.assessmentStatus !== 'context_complete') {
          return {
            modelExecution: reassessedModel,
            initialModelExecution: generated,
            assessment: reassessed,
            initialAssessment: assessment,
            assessmentRecord: reassessedRecord,
            initialAssessmentRecord: assessmentRecord,
            retrieval,
            draft: null,
          };
        }
        const eligibility = await preparationEligibility.evaluate(reassessedRecord.id);
        const draft = await internalDraft.create({
          eligibility,
          subject: reassessedFollowthrough.email.subject,
          body: reassessedFollowthrough.email.body,
        });
        return {
          modelExecution: reassessedModel,
          initialModelExecution: generated,
          assessment: reassessed,
          initialAssessment: assessment,
          assessmentRecord: reassessedRecord,
          initialAssessmentRecord: assessmentRecord,
          retrieval,
          eligibility,
          draft,
        };
      }

      const eligibility = await preparationEligibility.evaluate(assessmentRecord.id);
      const draft = await internalDraft.create({ eligibility, subject: followthrough.email.subject, body: followthrough.email.body });
      return { modelExecution: generated, assessment, assessmentRecord, eligibility, draft };
    },
  };
}

export type SalesQualifiedLeadFollowthroughService = ReturnType<typeof createSalesQualifiedLeadFollowthroughService>;
