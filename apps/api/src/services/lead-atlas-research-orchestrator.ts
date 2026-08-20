import type { LeadAtlasContextService } from './lead-atlas-context-service.js';
import type { LeadAtlasResearchPlanner } from './lead-atlas-research-planner.js';
import type { LeadResearchWorkflowOutput, LeadResearchWorkflowService } from './lead-research-workflow-service.js';
import type { LeadResearchQualificationEvidenceService } from './lead-research-qualification-evidence-service.js';
import type { LeadPreliminaryQualificationService, PreliminaryLeadQualificationResult } from './lead-preliminary-qualification-service.js';
import type { LeadPreliminaryQualificationPersistenceService } from './lead-preliminary-qualification-persistence-service.js';
import type { LeadQualificationDisposition, LeadQualificationDispositionService } from './lead-qualification-disposition-service.js';
import type { LeadQualificationDispositionPersistenceService } from './lead-qualification-disposition-persistence-service.js';
import type { LeadQualificationRuntimeReviewService } from './lead-qualification-runtime-review-service.js';
import type { LeadQualificationRuntimeReviewRegistrationService } from './lead-qualification-runtime-review-registration-service.js';

export interface AtlasLeadResearchInput {
  geographicFocus?: string;
  country?: string;
  maxQueries?: number;
  maxBusinessesPerQuery?: number;
  maxWebResultsPerBusiness?: number;
  executionId: string;
  correlationId: string;
}

export type QualifiedEnrichedLead = LeadResearchWorkflowOutput['enriched'][number] & {
  preliminaryQualification: PreliminaryLeadQualificationResult;
  preliminaryQualificationRecordId: string;
  qualificationDisposition: LeadQualificationDisposition;
  qualificationDispositionRecordId: string;
  qualificationReviewTaskId: string;
  qualificationReviewExecutionId: string;
};

export interface AtlasLeadResearchOutput {
  queries: string[];
  atlasSourcePaths: string[];
  discovered: number;
  enriched: QualifiedEnrichedLead[];
  proposals: LeadResearchWorkflowOutput['proposals'];
}

function required(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${field} is required.`);
  return trimmed;
}

export function createLeadAtlasResearchOrchestrator(
  atlasContext: Pick<LeadAtlasContextService, 'load'>,
  planner: Pick<LeadAtlasResearchPlanner, 'plan'>,
  workflow: Pick<LeadResearchWorkflowService, 'research'>,
  evidenceBuilder?: Pick<LeadResearchQualificationEvidenceService, 'build'>,
  qualificationService?: Pick<LeadPreliminaryQualificationService, 'evaluate'>,
  qualificationPersistence?: Pick<LeadPreliminaryQualificationPersistenceService, 'persist'>,
  dispositionService?: Pick<LeadQualificationDispositionService, 'evaluate'>,
  dispositionPersistence?: Pick<LeadQualificationDispositionPersistenceService, 'persist'>,
  runtimeReviewService?: Pick<LeadQualificationRuntimeReviewService, 'createTask'>,
  runtimeReviewRegistration?: Pick<LeadQualificationRuntimeReviewRegistrationService, 'register'>,
) {
  const qualificationDependencies = [
    evidenceBuilder,
    qualificationService,
    qualificationPersistence,
    dispositionService,
    dispositionPersistence,
    runtimeReviewService,
    runtimeReviewRegistration,
  ];
  const configuredQualificationDependencies = qualificationDependencies.filter(Boolean).length;
  if (configuredQualificationDependencies !== 0 && configuredQualificationDependencies !== qualificationDependencies.length) {
    throw new Error('Lead qualification pipeline requires evidence builder, qualification service, qualification persistence, disposition service, disposition persistence, runtime review service, and runtime review registration together.');
  }

  return {
    async research(input: AtlasLeadResearchInput): Promise<AtlasLeadResearchOutput> {
      const executionId = required(input.executionId, 'executionId');
      const correlationId = required(input.correlationId, 'correlationId');
      const atlas = await atlasContext.load();
      const plan = planner.plan({
        atlas,
        ...(input.geographicFocus ? { geographicFocus: input.geographicFocus } : {}),
        ...(input.maxQueries !== undefined ? { maxQueries: input.maxQueries } : {}),
      });

      const enriched: QualifiedEnrichedLead[] = [];
      const proposals: LeadResearchWorkflowOutput['proposals'] = [];
      let discovered = 0;

      for (const [index, query] of plan.queries.entries()) {
        const result = await workflow.research({
          query,
          executionId: `${executionId}:atlas-query-${index + 1}`,
          correlationId,
          ...(input.country ? { country: input.country } : {}),
          ...(input.maxBusinessesPerQuery !== undefined ? { maxBusinesses: input.maxBusinessesPerQuery } : {}),
          ...(input.maxWebResultsPerBusiness !== undefined ? { maxWebResultsPerBusiness: input.maxWebResultsPerBusiness } : {}),
        });
        discovered += result.discovered;
        proposals.push(...result.proposals);

        for (const lead of result.enriched) {
          if (!evidenceBuilder || !qualificationService || !qualificationPersistence || !dispositionService || !dispositionPersistence || !runtimeReviewService || !runtimeReviewRegistration) {
            throw new Error('Atlas Lead research produced an enriched lead without a fully configured governed qualification review pipeline.');
          }
          const assessments = evidenceBuilder.build({
            atlas,
            companyName: lead.companyName,
            officialWebsiteUrl: lead.officialWebsiteUrl,
            publicWebResults: lead.publicWebEvidence,
          });
          const preliminaryQualification = qualificationService.evaluate({ atlas, assessments });
          const persistedQualification = await qualificationPersistence.persist({
            leadId: lead.leadId,
            assessments,
            result: preliminaryQualification,
            actorId: 'lead_agent',
          });
          const qualificationDisposition = dispositionService.evaluate(preliminaryQualification);
          const persistedDisposition = await dispositionPersistence.persist({
            leadId: lead.leadId,
            qualificationRecordId: persistedQualification.id,
            disposition: qualificationDisposition,
            actorId: 'lead_agent',
          });
          const qualificationReviewTask = runtimeReviewService.createTask({
            taskId: `lead-qualification-review-task:${persistedDisposition.id}`,
            executionId: `lead-qualification-review:${persistedDisposition.id}`,
            correlationId,
            leadId: lead.leadId,
            qualificationRecordId: persistedQualification.id,
            dispositionRecordId: persistedDisposition.id,
            disposition: qualificationDisposition,
            confidence: 1,
            createdAt: persistedDisposition.createdAt,
          });
          const qualificationReviewRecord = await runtimeReviewRegistration.register(qualificationReviewTask);
          enriched.push({
            ...lead,
            preliminaryQualification,
            preliminaryQualificationRecordId: persistedQualification.id,
            qualificationDisposition,
            qualificationDispositionRecordId: persistedDisposition.id,
            qualificationReviewTaskId: qualificationReviewRecord.task.taskId,
            qualificationReviewExecutionId: qualificationReviewRecord.task.executionId,
          });
        }
      }

      return { queries: plan.queries, atlasSourcePaths: plan.atlasSourcePaths, discovered, enriched, proposals };
    },
  };
}

export type LeadAtlasResearchOrchestrator = ReturnType<typeof createLeadAtlasResearchOrchestrator>;
