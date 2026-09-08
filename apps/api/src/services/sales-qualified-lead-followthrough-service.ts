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
import { normalizeSalesResearchEvidence } from './sales-research-evidence-normalizer.js';

const SALES_QUALIFIED_LEAD_FOLLOWTHROUGH_CAPABILITY = 'sales_qualified_lead_followthrough';
const SALES_CONTEXT_RECOVERY_INTERVAL_MS = 15 * 60_000;
const SALES_CONTEXT_RECOVERY_MIN_AGE_MS = 15 * 60_000;
const SALES_CONTEXT_RECOVERY_MAX_ATTEMPTS = 3;

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
  try { parsed = JSON.parse(candidate); } catch { throw new Error('Sales followthrough model returned invalid JSON.'); }
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
  internalOperationalHistory?: unknown;
}): AgentRuntimeTask {
  const boundedResearchEvidence = input.researchEvidence?.length ? normalizeSalesResearchEvidence(input.researchEvidence) : [];
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
      salesBrief: 'Return strict JSON containing salesContext and an email subject/body. Required salesContext fields are decisionMaker, contactEmail, industry, country, businessSummary, websiteAudit, painPoints, recommendedServices, priority, confidence, previousContact, and opportunitySummary. Populate every field only when directly supported by supplied evidence; otherwise omit it. Keep arrays concise and evidence-backed. Do not omit a supported field merely because it is inconvenient to extract.',
      salesContext: JSON.stringify({ lead: input.lead, qualification: input.qualification, intakeResult: input.intakeResult, ...(boundedResearchEvidence.length ? { additionalPublicWebEvidence: boundedResearchEvidence } : {}), ...(input.internalOperationalHistory ? { internalOperationalHistory: input.internalOperationalHistory } : {}) }),
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
  registerModelRuntimeCapability(handlers, integrations, { agentId: 'sales_agent', capabilityId: SALES_QUALIFIED_LEAD_FOLLOWTHROUGH_CAPABILITY, integrationId: modelIntegrationId, mode: 'draft', promptInputKey: 'salesBrief', contextInputKey: 'salesContext', systemInstruction: ['You are the AxorOS Sales Agent operating in governed internal draft mode.', 'Return JSON only with keys salesContext and email.', 'Use only facts explicitly present in the supplied persisted lead, qualification, intake result, additional public-web evidence, internal operational history, or Atlas references.', 'Treat internal operational history as authoritative for AxorOS contact history. Do not use public-web results to infer whether AxorOS previously contacted the lead.', 'If internal operational history contains no recorded AxorOS outreach/contact event for the lead, previousContact must be false. If it contains a recorded completed outreach/contact event, previousContact may be true only when the event explicitly supports that conclusion.', 'Never invent a decision maker, industry, country, business summary, website audit, pain point, recommended service, priority, confidence, previous contact status, pricing, discount, budget, contract term, delivery promise, or approval.', 'If the evidence does not support a required sales context field, leave it absent so the downstream assessment fails closed rather than guessing.', 'When additional public-web evidence is supplied, inspect it field-by-field and extract directly supported facts before deciding a field is missing.', 'The email is an internal candidate draft for human review; do not send it and do not imply outreach authority.', 'Do not include prices or commercial commitments unless explicitly present in the supplied evidence.'].join(' '), maxOutputTokens: 2000, temperature: 0.2 });
  const orchestrator = createAgentRuntimeOrchestrator({ store, handlers });

  async function ensureModelExecution(input: { executionId: string; intake: AgentRuntimeExecutionRecord; lead: Awaited<ReturnType<typeof operationalRepository.getLeadById>>; qualification: unknown; researchEvidence?: PublicWebSearchResult[]; internalOperationalHistory?: unknown; }): Promise<AgentRuntimeExecutionRecord> {
    if (!input.lead) throw new Error('Sales followthrough lead is required.');
    let modelExecution = await store.getExecution(input.executionId);
    if (!modelExecution) {
      const task = buildSalesFollowthroughTask({ executionId: input.executionId, leadId: input.lead.id, correlationId: input.intake.task.correlationId, atlasSourcePaths: input.intake.task.knowledgeReferences, lead: input.lead, qualification: input.qualification, intakeResult: input.intake.result?.output ?? {}, createdAt: new Date().toISOString(), ...(input.researchEvidence ? { researchEvidence: input.researchEvidence } : {}), ...(input.internalOperationalHistory ? { internalOperationalHistory: input.internalOperationalHistory } : {}) });
      const idempotencyKey = runtimeIdempotencyKey('runtime', input.executionId, 'task_created');
      if (await store.hasIdempotencyKey(idempotencyKey)) modelExecution = await store.getExecution(input.executionId);
      else {
        const event: AgentRuntimeEvent = { eventId: randomUUID(), executionId: input.executionId, taskId: task.taskId, correlationId: task.correlationId, type: 'task_created', actor: 'runtime', payload: { originAgent: 'lead_agent', destinationAgent: 'sales_agent', salesIntakeOnly: true, salesDispatchAuthorised: false, outreachAuthorised: false }, idempotencyKey, occurredAt: task.createdAt };
        const record: AgentRuntimeExecutionRecord = { task, version: 1, lastEventId: event.eventId, persistedAt: task.createdAt };
        await commitRuntimeMutation({ record, expectedVersion: 0, event, idempotencyRecord: recordRuntimeIdempotency(event, 'task_created') });
        modelExecution = record;
      }
    }
    if (!modelExecution) throw new Error(`Sales followthrough execution ${input.executionId} could not be created.`);
    if (modelExecution.task.status === 'completed' && modelExecution.result?.status === 'completed') return modelExecution;
    return (await orchestrator.execute({ executionId: input.executionId, capabilityId: SALES_QUALIFIED_LEAD_FOLLOWTHROUGH_CAPABILITY })).record;
  }

  async function recoverContextIncomplete(limit = 10): Promise<void> {
    const result = await pool.query(
      `with latest_assessments as (
         select distinct on (payload ->> 'leadId') id, payload, created_at
         from operational.workflow_events
         where event_type = 'sales_opportunity_assessment_recorded'
         order by payload ->> 'leadId', created_at desc
       )
       select id, payload, created_at
       from latest_assessments
       where payload ->> 'assessmentStatus' = 'context_incomplete'
         and created_at < now() - ($1::text || ' milliseconds')::interval
       order by created_at asc
       limit $2`,
      [String(SALES_CONTEXT_RECOVERY_MIN_AGE_MS), Math.max(1, Math.min(limit, 25))],
    );
    console.info(JSON.stringify({ level: 'info', event: 'sales_context_recovery_scan', candidateCount: result.rows.length, maxAttempts: SALES_CONTEXT_RECOVERY_MAX_ATTEMPTS }));

    for (const row of result.rows) {
      try {
        const payload = row.payload as Record<string, unknown>;
        const leadId = typeof payload.leadId === 'string' ? payload.leadId : '';
        const intakeExecutionId = typeof payload.salesIntakeExecutionId === 'string' ? payload.salesIntakeExecutionId : '';
        const sourceAssessmentRecordId = String(row.id);
        const missingFields = Array.isArray(payload.missingInformation) ? payload.missingInformation.filter((value): value is string => typeof value === 'string' && Boolean(value.trim())) : [];
        if (!leadId || !intakeExecutionId || missingFields.length === 0) continue;

        const attemptsResult = await pool.query(
          `select count(*)::int as count
           from operational.workflow_events
           where event_type = 'sales_context_recovery_attempted'
             and payload ->> 'leadId' = $1
             and payload ->> 'sourceAssessmentRecordId' = $2`,
          [leadId, sourceAssessmentRecordId],
        );
        const attempts = Number(attemptsResult.rows[0]?.count ?? 0);
        if (attempts >= SALES_CONTEXT_RECOVERY_MAX_ATTEMPTS) continue;
        const attemptNumber = attempts + 1;
        const intake = await store.getExecution(intakeExecutionId);
        if (!intake) continue;
        if (intake.task.destinationAgent !== 'sales_agent') continue;
        if (intake.task.status !== 'completed' || intake.result?.status !== 'completed') continue;
        if (intake.task.inputs.salesIntakeOnly !== true || intake.task.inputs.salesDispatchAuthorised !== false || intake.task.inputs.outreachAuthorised !== false) continue;
        const lead = await operationalRepository.getLeadById(leadId);
        if (!lead) continue;
        const qualifications = await operationalRepository.listPreliminaryLeadQualifications(leadId);
        const qualification = qualifications[0] ?? null;
        if (!qualification) continue;
        const workflowHistory = await operationalRepository.listWorkflowEventsByLeadId(leadId);
        const internalOperationalHistory = { leadId, events: workflowHistory.map((event) => ({ eventType: event.eventType, actorType: event.actorType, actorId: event.actorId, createdAt: event.createdAt, payload: event.payload })) };
        const recoveryExecutionId = `sales-followthrough:${intakeExecutionId}:context-recovery:${sourceAssessmentRecordId}:attempt:${attemptNumber}:${randomUUID()}`;

        await operationalRepository.createWorkflowEvent({ eventType: 'sales_context_recovery_attempted', actorType: 'agent', actorId: 'sales_agent', payload: { leadId, salesIntakeExecutionId: intakeExecutionId, sourceAssessmentRecordId, attemptNumber, missingFields, recoveryExecutionId, nextAction: 'retrieve_missing_sales_context' } });
        console.info(JSON.stringify({ level: 'info', event: 'sales_context_recovery_attempted', leadId, sourceAssessmentRecordId, attemptNumber, recoveryExecutionId, missingFields }));

        const retrieval = await missingContextRetrieval.retrieve({ lead, missingFields, executionId: recoveryExecutionId, correlationId: intake.task.correlationId, ...(typeof payload.salesContext === 'object' && payload.salesContext && !Array.isArray(payload.salesContext) && typeof (payload.salesContext as Record<string, unknown>).country === 'string' ? { country: (payload.salesContext as Record<string, unknown>).country as string } : {}) });
        await operationalRepository.createWorkflowEvent({ eventType: 'sales_missing_context_retrieval_recorded', actorType: 'agent', actorId: 'sales_agent', payload: { leadId: retrieval.leadId, missingFields: retrieval.missingFields, searchesRun: retrieval.searchesRun, evidenceCount: retrieval.evidence.length, evidenceReferences: retrieval.evidence.map((item) => `public-web:${item.url}`), recoveryExecutionId, sourceAssessmentRecordId, attemptNumber, nextAction: retrieval.nextAction } });
        console.info(JSON.stringify({ level: 'info', event: 'sales_missing_context_retrieval_recorded', leadId, sourceAssessmentRecordId, attemptNumber, recoveryExecutionId, searchesRun: retrieval.searchesRun, evidenceCount: retrieval.evidence.length }));

        const reassessedModel = await ensureModelExecution({ executionId: recoveryExecutionId, intake, lead, qualification, researchEvidence: retrieval.evidence, internalOperationalHistory });
        if (reassessedModel.task.status !== 'completed' || reassessedModel.result?.status !== 'completed') throw new Error('Sales context recovery model execution did not complete.');
        const reassessedFollowthrough = parseGeneratedOutput(String(reassessedModel.result?.output.text ?? ''));
        const reassessed = assessmentService.assess({ intakeExecution: intake, lead, salesContext: reassessedFollowthrough.salesContext });
        const reassessedRecord = await assessmentPersistence.persist({ assessment: reassessed });

        if (reassessed.assessmentStatus === 'context_complete') {
          const eligibility = await preparationEligibility.evaluate(reassessedRecord.id);
          const draft = await internalDraft.create({ eligibility, subject: reassessedFollowthrough.email.subject, body: reassessedFollowthrough.email.body });
          await operationalRepository.createWorkflowEvent({ eventType: 'sales_context_recovery_completed', actorType: 'agent', actorId: 'sales_agent', payload: { leadId, salesIntakeExecutionId: intakeExecutionId, sourceAssessmentRecordId, attemptNumber, recoveryExecutionId, assessmentStatus: 'context_complete', draftRecordId: draft.record.id, outreachAuthorised: false, sendAuthorised: false, pricingAuthorised: false, commercialCommitmentAuthorised: false, nextAction: 'human_review_internal_outreach_draft' } });
          console.info(JSON.stringify({ level: 'info', event: 'sales_context_recovery_completed', leadId, sourceAssessmentRecordId, attemptNumber, recoveryExecutionId, assessmentStatus: 'context_complete', outreachAuthorised: false, sendAuthorised: false }));
        } else {
          await operationalRepository.createWorkflowEvent({ eventType: 'sales_context_recovery_completed', actorType: 'agent', actorId: 'sales_agent', payload: { leadId, salesIntakeExecutionId: intakeExecutionId, sourceAssessmentRecordId, attemptNumber, recoveryExecutionId, assessmentStatus: 'context_incomplete', missingInformation: reassessed.missingInformation, outreachAuthorised: false, sendAuthorised: false, pricingAuthorised: false, commercialCommitmentAuthorised: false, nextAction: reassessed.nextAction } });
          console.info(JSON.stringify({ level: 'info', event: 'sales_context_recovery_completed', leadId, sourceAssessmentRecordId, attemptNumber, recoveryExecutionId, assessmentStatus: 'context_incomplete', missingInformation: reassessed.missingInformation }));
        }
      } catch (error) {
        console.error(JSON.stringify({ level: 'error', event: 'sales_context_recovery_failed', leadId: typeof (row.payload as Record<string, unknown>).leadId === 'string' ? (row.payload as Record<string, unknown>).leadId : undefined, sourceAssessmentRecordId: String(row.id), error: error instanceof Error ? error.message : String(error) }));
      }
    }
  }

  let recoveryInFlight = false;
  const runRecoveryCycle = (trigger: 'startup' | 'interval') => {
    if (recoveryInFlight) return;
    recoveryInFlight = true;
    void recoverContextIncomplete().catch((error) => {
      console.error(JSON.stringify({ level: 'error', event: 'sales_context_recovery_cycle_failed', trigger, error: error instanceof Error ? error.message : String(error) }));
    }).finally(() => { recoveryInFlight = false; });
  };
  const recoveryTimer = setInterval(() => runRecoveryCycle('interval'), SALES_CONTEXT_RECOVERY_INTERVAL_MS);
  recoveryTimer.unref();
  runRecoveryCycle('startup');

  return {
    store,
    recoverContextIncomplete,
    async executeAfterIntake(intakeExecutionId: string) {
      const intake = await store.getExecution(required(intakeExecutionId, 'intakeExecutionId'));
      if (!intake) throw new Error(`Sales intake execution ${intakeExecutionId} was not found.`);
      if (intake.task.destinationAgent !== 'sales_agent') throw new Error('Sales followthrough requires Sales Agent destination.');
      if (intake.task.status !== 'completed' || intake.result?.status !== 'completed') throw new Error('Sales followthrough requires a completed internal Sales intake.');
      if (intake.task.inputs.salesIntakeOnly !== true || intake.task.inputs.salesDispatchAuthorised !== false || intake.task.inputs.outreachAuthorised !== false) throw new Error('Sales followthrough requires intake-only authority.');
      const leadId = required(String(intake.task.context.leadId ?? ''), 'leadId');
      const lead = await operationalRepository.getLeadById(leadId);
      if (!lead) throw new Error(`Lead not found: ${leadId}.`);
      const qualifications = await operationalRepository.listPreliminaryLeadQualifications(leadId);
      const qualification = qualifications[0] ?? null;
      if (!qualification) throw new Error(`Lead qualification record not found for ${leadId}.`);
      const workflowHistory = await operationalRepository.listWorkflowEventsByLeadId(leadId);
      const internalOperationalHistory = { leadId, events: workflowHistory.map((event) => ({ eventType: event.eventType, actorType: event.actorType, actorId: event.actorId, createdAt: event.createdAt, payload: event.payload })) };
      const executionId = `sales-followthrough:${intakeExecutionId}`;
      const generated = await ensureModelExecution({ executionId, intake, lead, qualification, internalOperationalHistory });
      if (generated.task.status !== 'completed' || generated.result?.status !== 'completed') throw new Error('Sales followthrough model execution did not complete.');
      const followthrough = parseGeneratedOutput(String(generated.result?.output.text ?? ''));
      const assessment = assessmentService.assess({ intakeExecution: intake, lead, salesContext: followthrough.salesContext });
      const assessmentRecord = await assessmentPersistence.persist({ assessment });
      if (assessment.assessmentStatus !== 'context_complete') {
        const retrieval = await missingContextRetrieval.retrieve({ lead, missingFields: assessment.missingInformation, executionId, correlationId: intake.task.correlationId, ...(assessment.salesContext.country ? { country: assessment.salesContext.country } : {}) });
        await operationalRepository.createWorkflowEvent({ eventType: 'sales_missing_context_retrieval_recorded', actorType: 'agent', actorId: 'sales_agent', payload: { leadId: retrieval.leadId, missingFields: retrieval.missingFields, searchesRun: retrieval.searchesRun, evidenceCount: retrieval.evidence.length, evidenceReferences: retrieval.evidence.map((item) => `public-web:${item.url}`), nextAction: retrieval.nextAction } });
        const reassessmentExecutionId = `${executionId}:context-retrieval`;
        const reassessedModel = await ensureModelExecution({ executionId: reassessmentExecutionId, intake, lead, qualification, researchEvidence: retrieval.evidence, internalOperationalHistory });
        if (reassessedModel.task.status !== 'completed' || reassessedModel.result?.status !== 'completed') throw new Error('Sales missing-context reassessment model execution did not complete.');
        const reassessedFollowthrough = parseGeneratedOutput(String(reassessedModel.result?.output.text ?? ''));
        const reassessed = assessmentService.assess({ intakeExecution: intake, lead, salesContext: reassessedFollowthrough.salesContext });
        const reassessedRecord = await assessmentPersistence.persist({ assessment: reassessed });
        if (reassessed.assessmentStatus !== 'context_complete') return { modelExecution: reassessedModel, initialModelExecution: generated, assessment: reassessed, initialAssessment: assessment, assessmentRecord: reassessedRecord, initialAssessmentRecord: assessmentRecord, retrieval, draft: null };
        const eligibility = await preparationEligibility.evaluate(reassessedRecord.id);
        const draft = await internalDraft.create({ eligibility, subject: reassessedFollowthrough.email.subject, body: reassessedFollowthrough.email.body });
        return { modelExecution: reassessedModel, initialModelExecution: generated, assessment: reassessed, initialAssessment: assessment, assessmentRecord: reassessedRecord, initialAssessmentRecord: assessmentRecord, retrieval, eligibility, draft };
      }
      const eligibility = await preparationEligibility.evaluate(assessmentRecord.id);
      const draft = await internalDraft.create({ eligibility, subject: followthrough.email.subject, body: followthrough.email.body });
      return { modelExecution: generated, assessment, assessmentRecord, eligibility, draft };
    },
  };
}

export type SalesQualifiedLeadFollowthroughService = ReturnType<typeof createSalesQualifiedLeadFollowthroughService>;
