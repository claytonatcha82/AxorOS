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
import type { LeadGapResearchService } from './lead-gap-research-service.js';
import type { QualificationCategory } from './lead-preliminary-qualification-service.js';
import { logEvent } from '../logger.js';

export interface AtlasLeadResearchQueryState {
  exhausted: boolean;
  lastAttemptedAt?: string;
  nextPageToken?: string | null;
}

export interface AtlasLeadResearchInput {
  geographicFocus?: string;
  geographicVariants?: string[];
  country?: string;
  maxQueries?: number;
  maxBusinessesPerQuery?: number;
  maxWebResultsPerBusiness?: number;
  queryState?: Record<string, AtlasLeadResearchQueryState>;
  executionId: string;
  correlationId: string;
}

export type QualifiedEnrichedLead = LeadResearchWorkflowOutput['enriched'][number] & {
  preliminaryQualification: PreliminaryLeadQualificationResult;
  preliminaryQualificationRecordId: string;
  qualificationDisposition: LeadQualificationDisposition;
  qualificationDispositionRecordId: string;
  qualificationReviewTaskId?: string;
  qualificationReviewExecutionId?: string;
};

export interface AtlasLeadResearchOutput {
  queries: string[];
  atlasSourcePaths: string[];
  discovered: number;
  enriched: QualifiedEnrichedLead[];
  proposals: LeadResearchWorkflowOutput['proposals'];
  outcomes: LeadResearchWorkflowOutput['outcomes'];
  updatedQueryState: Record<string, { exhausted: boolean; lastAttemptedAt: string; nextPageToken?: string | null }>;
}

function required(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${field} is required.`);
  return trimmed;
}

function identifyEvidenceGaps(assessments: Record<QualificationCategory, { score: number | null }>): QualificationCategory[] {
  const gaps: QualificationCategory[] = [];
  for (const [category, assessment] of Object.entries(assessments) as [QualificationCategory, { score: number | null }][]) {
    if (assessment.score === null || assessment.score < 8) gaps.push(category);
  }
  return gaps;
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
  gapResearchService?: Pick<LeadGapResearchService, 'researchGaps'>,
) {
  const qualificationDependencies = [evidenceBuilder, qualificationService, qualificationPersistence, dispositionService, dispositionPersistence, runtimeReviewService, runtimeReviewRegistration];
  const configuredQualificationDependencies = qualificationDependencies.filter(Boolean).length;
  if (configuredQualificationDependencies !== 0 && configuredQualificationDependencies !== qualificationDependencies.length) {
    throw new Error('Lead qualification pipeline requires evidence builder, qualification service, qualification persistence, disposition service, disposition persistence, runtime review service, and runtime review registration together.');
  }

  return {
    async research(input: AtlasLeadResearchInput): Promise<AtlasLeadResearchOutput> {
      const executionId = required(input.executionId, 'executionId');
      const correlationId = required(input.correlationId, 'correlationId');
      const atlas = await atlasContext.load();
      const exhaustedQueries = Object.entries(input.queryState ?? {}).filter(([, state]) => state.exhausted).map(([query]) => query);
      const plan = planner.plan({
        atlas,
        ...(input.geographicFocus ? { geographicFocus: input.geographicFocus } : {}),
        ...(input.geographicVariants ? { geographicVariants: input.geographicVariants } : {}),
        ...(input.maxQueries !== undefined ? { maxQueries: input.maxQueries } : {}),
        ...(exhaustedQueries.length ? { exhaustedQueries } : {}),
      });

      const enriched: QualifiedEnrichedLead[] = [];
      const proposals: LeadResearchWorkflowOutput['proposals'] = [];
      const outcomes: LeadResearchWorkflowOutput['outcomes'] = {
        enriched: 0,
        duplicateSkipped: 0,
        webResearchFailed: 0,
        unresolved: 0,
        ambiguous: 0,
        notFound: 0,
        skipped: 0,
      };
      const updatedQueryState: Record<string, { exhausted: boolean; lastAttemptedAt: string; nextPageToken?: string | null }> = {};
      let discovered = 0;

      for (const [index, query] of plan.queries.entries()) {
        const attemptedAt = new Date().toISOString();
        const queryStateEntry = input.queryState?.[query];
        const pageToken = queryStateEntry?.nextPageToken ?? undefined;

        const result = await workflow.research({
          query,
          executionId: `${executionId}:atlas-query-${index + 1}`,
          correlationId,
          ...(input.country ? { country: input.country } : {}),
          ...(input.maxBusinessesPerQuery !== undefined ? { maxBusinesses: input.maxBusinessesPerQuery } : {}),
          ...(input.maxWebResultsPerBusiness !== undefined ? { maxWebResultsPerBusiness: input.maxWebResultsPerBusiness } : {}),
          ...(pageToken ? { pageToken } : {}),
        });
        updatedQueryState[query] = {
          exhausted: result.exhausted,
          lastAttemptedAt: attemptedAt,
          nextPageToken: result.nextPageToken ?? null,
        };
        discovered += result.discovered;
        proposals.push(...result.proposals);
        outcomes.enriched += result.outcomes.enriched;
        outcomes.duplicateSkipped += result.outcomes.duplicateSkipped;
        outcomes.webResearchFailed += result.outcomes.webResearchFailed;
        outcomes.unresolved += result.outcomes.unresolved;
        outcomes.ambiguous += result.outcomes.ambiguous;
        outcomes.notFound += result.outcomes.notFound;
        outcomes.skipped += result.outcomes.skipped;

        for (const lead of result.enriched) {
          if (!evidenceBuilder || !qualificationService || !qualificationPersistence || !dispositionService || !dispositionPersistence || !runtimeReviewService || !runtimeReviewRegistration) {
            throw new Error('Atlas Lead research produced an enriched lead without a fully configured governed qualification review pipeline.');
          }

          let publicWebResults = lead.publicWebEvidence;
          let assessments = evidenceBuilder.build({
            atlas,
            companyName: lead.companyName,
            officialWebsiteUrl: lead.officialWebsiteUrl,
            publicWebResults,
          });

          if (gapResearchService) {
            const gaps = identifyEvidenceGaps(assessments);
            if (gaps.length > 0) {
              logEvent('info', 'lead_gap_research_triggered', {
                leadId: lead.leadId,
                companyName: lead.companyName,
                gaps,
                initialScore: Object.fromEntries(Object.entries(assessments).map(([k, v]) => [k, v.score])),
              });

              const gapResult = await gapResearchService.researchGaps({
                companyName: lead.companyName,
                officialWebsiteUrl: lead.officialWebsiteUrl,
                ...(lead.formattedAddress ? { formattedAddress: lead.formattedAddress } : {}),
                missingCategories: gaps,
                existingEvidence: publicWebResults,
                executionId: `${executionId}:gap-research:${lead.leadId}`,
                correlationId,
                ...(input.country ? { country: input.country } : {}),
                maxResultsPerSearch: input.maxWebResultsPerBusiness ?? 5,
              });

              if (gapResult.additionalResults.length > 0) {
                publicWebResults = [...publicWebResults, ...gapResult.additionalResults];
                assessments = evidenceBuilder.build({
                  atlas,
                  companyName: lead.companyName,
                  officialWebsiteUrl: lead.officialWebsiteUrl,
                  publicWebResults,
                });
              }

              logEvent('info', 'lead_gap_research_completed', {
                leadId: lead.leadId,
                companyName: lead.companyName,
                searchesPerformed: gapResult.searchesPerformed,
                categoriesResearched: gapResult.categoriesResearched,
                additionalResults: gapResult.additionalResults.length,
                updatedScore: Object.fromEntries(Object.entries(assessments).map(([k, v]) => [k, v.score])),
              });
            }
          }

          const preliminaryQualification = qualificationService.evaluate({ atlas, assessments });
          const persistedQualification = await qualificationPersistence.persist({ leadId: lead.leadId, assessments, result: preliminaryQualification, actorId: 'lead_agent' });
          const qualificationDisposition = dispositionService.evaluate(preliminaryQualification);
          const persistedDisposition = await dispositionPersistence.persist({ leadId: lead.leadId, qualificationRecordId: persistedQualification.id, disposition: qualificationDisposition, actorId: 'lead_agent' });

          let qualificationReviewTaskId: string | undefined;
          let qualificationReviewExecutionId: string | undefined;
          if (qualificationDisposition.disposition === 'hold') {
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
            qualificationReviewTaskId = qualificationReviewRecord.task.taskId;
            qualificationReviewExecutionId = qualificationReviewRecord.task.executionId;
          }

          enriched.push({
            ...lead,
            preliminaryQualification,
            preliminaryQualificationRecordId: persistedQualification.id,
            qualificationDisposition,
            qualificationDispositionRecordId: persistedDisposition.id,
            ...(qualificationReviewTaskId ? { qualificationReviewTaskId } : {}),
            ...(qualificationReviewExecutionId ? { qualificationReviewExecutionId } : {}),
          });
        }
      }

      const preservedQueryState = Object.fromEntries(
        Object.entries(input.queryState ?? {})
          .filter(([query]) => !Object.prototype.hasOwnProperty.call(updatedQueryState, query))
          .map(([query, state]) => [query, {
            exhausted: state.exhausted,
            lastAttemptedAt: state.lastAttemptedAt ?? new Date().toISOString(),
            ...(state.nextPageToken !== undefined ? { nextPageToken: state.nextPageToken } : {}),
          }]),
      );

      return {
        queries: plan.queries,
        atlasSourcePaths: plan.atlasSourcePaths,
        discovered,
        enriched,
        proposals,
        outcomes,
        updatedQueryState: { ...preservedQueryState, ...updatedQueryState },
      };
    },
  };
}

export type LeadAtlasResearchOrchestrator = ReturnType<typeof createLeadAtlasResearchOrchestrator>;
