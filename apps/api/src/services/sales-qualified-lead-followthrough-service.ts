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

export function parseGeneratedOutput(raw: string): GeneratedFollowthrough {
  const normalized = raw.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
  const parsed = JSON.parse(normalized) as Partial<GeneratedFollowthrough>;
  if (!parsed || typeof parsed !== 'object' || !parsed.salesContext || typeof parsed.salesContext !== 'object') {
    throw new Error('Sales followthrough model output must contain salesContext.');
  }
  if (!parsed.email || typeof parsed.email !== 'object') throw new Error('Sales followthrough model output must contain email.');
  const subject = typeof parsed.email.subject === 'string' ? parsed.email.subject.trim() : '';
  const body = typeof parsed.email.body === 'string' ? parsed.email.body.trim() : '';
  if (!subject || !body) throw new Error('Sales followthrough model output must contain a complete internal email draft.');
  return { salesContext: parsed.salesContext as SalesOpportunityContext, email: { subject, body } };
}

export function buildSalesFollowthroughTask(input: {
  intake: AgentRuntimeExecutionRecord;
  lead: { id: string; companyName: string; contactName: string | null; contactEmail: string | null; opportunitySummary: string | null; evidence: unknown };
  qualification: { id: string; totalScore: number | null; suggestedStatus: string; assessments: unknown; missingInformation: unknown; atlasSourcePaths: unknown };
}): AgentRuntimeTask {
  const atlasSourcePaths = Array.isArray(input.qualification.atlasSourcePaths)
    ? input.qualification.atlasSourcePaths.filter((value): value is string => typeof value === 'string')
    : [];
  return validateAgentRuntimeTask({
    id: `sales-followthrough:${input.intake.id}`,
    originAgent: 'lead_agent',
    destinationAgent: 'sales_agent',
    objective: 'Execute governed qualified-lead Sales followthrough and prepare an internal outreach draft for Human Executive review.',
    status: 'ready',
    nextAction: 'execute_qualified_lead_sales_followthrough',
    approvalRequired: false,
    maxAttempts: 1,
    correlationId: input.intake.task.correlationId,
    context: {
      leadId: input.lead.id,
      companyName: input.lead.companyName,
      contactName: input.lead.contactName,
      contactEmail: input.lead.contactEmail,
      opportunitySummary: input.lead.opportunitySummary,
      leadEvidence: input.lead.evidence,
      qualificationId: input.qualification.id,
      qualificationScore: input.qualification.totalScore,
      qualificationStatus: input.qualification.suggestedStatus,
      qualificationAssessments: input.qualification.assessments,
      qualificationMissingInformation: input.qualification.missingInformation,
      atlasSourcePaths: [...new Set(atlasSourcePaths)],
    },
    inputs: {
      salesIntakeOnly: true,
      salesDispatchAuthorised: false,
      outreachAuthorised: false,
      pricingAuthorised: false,
      commercialCommitmentAuthorised: false,
    },
  });
}

function presentText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function parseAtlasReferences(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
}

function buildModelInstruction(input: { lead: { companyName: string; contactName: string | null; contactEmail: string | null; opportunitySummary: string | null; evidence: unknown }; qualification: { totalScore: number | null; suggestedStatus: string; assessments: unknown; missingInformation: unknown }; atlasSourcePaths: string[]; retrievedEvidence?: PublicWebSearchResult[]; missingFields?: string[] }) {
  return [
    'Return JSON only with keys salesContext and email.',
    'Use only facts explicitly supported by the persisted lead, qualification, Atlas references, and supplied public-web evidence.',
    'Never invent a decision maker, industry, country, business summary, website audit, pain points, recommended services, priority, confidence, previous contact, pricing, discount, budget, contract term, delivery promise, approval, or any other unsupported fact.',
    'If required Sales context is not evidenced, leave it absent so deterministic downstream assessment can fail closed.',
    'The email must be an internal outreach draft only; do not send it and do not imply that it was sent.',
    'Do not include prices or commercial commitments unless explicitly evidenced.',
    `Lead: ${JSON.stringify(input.lead)}`,
    `Qualification: ${JSON.stringify(input.qualification)}`,
    `Atlas source paths: ${JSON.stringify(input.atlasSourcePaths)}`,
    `Missing Sales context fields: ${JSON.stringify(input.missingFields ?? [])}`,
    `Retrieved public-web evidence: ${JSON.stringify(input.retrievedEvidence ?? [])}`,
  ].join('\n');
}

export function createSalesQualifiedLeadFollowthroughService(pool: Pool, registry: IntegrationRegistry) {
  const store = createAgentRuntimePostgresStore(pool);
  const operationalRepository = createOperationalRepository(pool);
  const assessmentService = createSalesOpportunityAssessmentService();
  const assessmentPersistence = createSalesOpportunityAssessmentPersistenceService(operationalRepository);
  const missingContextRetrieval = createSalesMissingContextRetrievalService(registry);
  const outreachEligibility = createSalesOutreachPreparationEligibilityService();
  const internalDraftService = createSalesInternalOutreachDraftService(operationalRepository);
  const registryHandlers = new AgentRuntimeHandlerRegistry();
  const orchestrator = createAgentRuntimeOrchestrator({ store, handlers: registryHandlers });

  function registerSalesModelCapability() {
    const integrationId = registry.get('model.gemini') ? 'model.gemini' : 'model.sandbox';
    registryHandlers.register(integrationId, async (request) => {
      const integration = registry.get(integrationId);
      if (!integration) throw new Error(`Sales model integration ${integrationId} is unavailable.`);
      return integration.execute(request);
    });
    registerModelRuntimeCapability(registryHandlers, {
      integrationId,
      agentId: 'sales_agent',
      capability: SALES_QUALIFIED_LEAD_FOLLOWTHROUGH_CAPABILITY,
      mode: 'draft',
      maxOutputTokens: 1200,
      temperature: 0.2,
    });
  }

  async function ensureModelExecution(input: { executionId: string; intake: AgentRuntimeExecutionRecord; lead: any; qualification: any; retrievedEvidence?: PublicWebSearchResult[]; missingFields?: string[] }) {
    const existing = await store.getExecution(input.executionId);
    if (existing) return existing;
    registerSalesModelCapability();
    const atlasSourcePaths = [...new Set(parseAtlasReferences(input.qualification.atlasSourcePaths))];
    const task = buildSalesFollowthroughTask({ intake: input.intake, lead: input.lead, qualification: input.qualification });
    const result = await orchestrator.execute({
      task: validateAgentRuntimeTask({
        ...task,
        id: input.executionId,
        context: {
          ...task.context,
          retrievedPublicWebEvidence: input.retrievedEvidence ?? [],
          missingSalesContextFields: input.missingFields ?? [],
          modelInstruction: buildModelInstruction({ lead: input.lead, qualification: input.qualification, atlasSourcePaths, retrievedEvidence: input.retrievedEvidence, missingFields: input.missingFields }),
        },
      }),
    });
    return result;
  }

  return {
    buildSalesFollowthroughTask,
    parseGeneratedOutput,
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
      await assessmentPersistence.persist({ assessment });

      if (assessment.assessmentStatus !== 'context_complete') {
        const retrieval = await missingContextRetrieval.retrieve({
          lead,
          missingFields: assessment.missingInformation,
          executionId,
          correlationId: intake.task.correlationId,
          ...(assessment.salesContext.country ? { country: assessment.salesContext.country } : {}),
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

        const reassessedGenerated = await ensureModelExecution({
          executionId: `${executionId}:reassessment`,
          intake,
          lead,
          qualification,
          retrievedEvidence: retrieval.evidence,
          missingFields: retrieval.missingFields,
        });
        if (reassessedGenerated.task.status !== 'completed' || reassessedGenerated.result?.status !== 'completed') throw new Error('Sales context reassessment model execution did not complete.');
        const reassessedFollowthrough = parseGeneratedOutput(String(reassessedGenerated.result?.output.text ?? ''));
        const reassessment = assessmentService.assess({ intakeExecution: intake, lead, salesContext: reassessedFollowthrough.salesContext });
        await assessmentPersistence.persist({ assessment: reassessment });
        if (reassessment.assessmentStatus !== 'context_complete') {
          return { status: 'blocked', nextAction: 'retrieve_missing_sales_context', assessment: reassessment };
        }
        const eligibility = outreachEligibility.assertEligible({ assessment: reassessment });
        const draft = internalDraftService.prepare({ assessment: reassessment, subject: reassessedFollowthrough.email.subject, body: reassessedFollowthrough.email.body });
        await internalDraftService.persist({ draft });
        return { status: 'review_required', nextAction: eligibility.nextAction, assessment: reassessment, draft };
      }

      const eligibility = outreachEligibility.assertEligible({ assessment });
      const draft = internalDraftService.prepare({ assessment, subject: followthrough.email.subject, body: followthrough.email.body });
      await internalDraftService.persist({ draft });
      return { status: 'review_required', nextAction: eligibility.nextAction, assessment, draft };
    },
  };
}
