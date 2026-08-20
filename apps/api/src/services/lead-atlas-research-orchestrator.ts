import type { LeadAtlasContextService } from './lead-atlas-context-service.js';
import type { LeadAtlasResearchPlanner } from './lead-atlas-research-planner.js';
import type { LeadResearchWorkflowOutput, LeadResearchWorkflowService } from './lead-research-workflow-service.js';
import type { LeadResearchQualificationEvidenceService } from './lead-research-qualification-evidence-service.js';
import type { LeadPreliminaryQualificationService, PreliminaryLeadQualificationResult } from './lead-preliminary-qualification-service.js';
import type { LeadPreliminaryQualificationPersistenceService } from './lead-preliminary-qualification-persistence-service.js';

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
) {
  const qualificationDependencies = [evidenceBuilder, qualificationService, qualificationPersistence];
  const configuredQualificationDependencies = qualificationDependencies.filter(Boolean).length;
  if (configuredQualificationDependencies !== 0 && configuredQualificationDependencies !== qualificationDependencies.length) {
    throw new Error('Lead qualification pipeline requires evidence builder, qualification service, and persistence service together.');
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
          if (!evidenceBuilder || !qualificationService || !qualificationPersistence) {
            throw new Error('Atlas Lead research produced an enriched lead without a fully configured qualification persistence pipeline.');
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
          enriched.push({
            ...lead,
            preliminaryQualification,
            preliminaryQualificationRecordId: persistedQualification.id,
          });
        }
      }

      return { queries: plan.queries, atlasSourcePaths: plan.atlasSourcePaths, discovered, enriched, proposals };
    },
  };
}

export type LeadAtlasResearchOrchestrator = ReturnType<typeof createLeadAtlasResearchOrchestrator>;
