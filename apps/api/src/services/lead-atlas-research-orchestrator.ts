import type { LeadAtlasContextService } from './lead-atlas-context-service.js';
import type { LeadAtlasResearchPlanner } from './lead-atlas-research-planner.js';
import type { LeadResearchWorkflowOutput, LeadResearchWorkflowService } from './lead-research-workflow-service.js';
import type { LeadResearchQualificationEvidenceService } from './lead-research-qualification-evidence-service.js';
import type { LeadPreliminaryQualificationService, PreliminaryLeadQualificationResult } from './lead-preliminary-qualification-service.js';

export interface AtlasLeadResearchInput {
  geographicFocus?: string;
  country?: string;
  maxQueries?: number;
  maxBusinessesPerQuery?: number;
  maxWebResultsPerBusiness?: number;
  executionId: string;
  correlationId: string;
}

export interface QualifiedEnrichedLead extends LeadResearchWorkflowOutput['enriched'][number] {
  preliminaryQualification: PreliminaryLeadQualificationResult;
}

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
) {
  if ((evidenceBuilder && !qualificationService) || (!evidenceBuilder && qualificationService)) {
    throw new Error('Lead qualification pipeline requires both evidence builder and qualification service.');
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
          if (!evidenceBuilder || !qualificationService) {
            throw new Error('Atlas Lead research produced an enriched lead without a configured qualification pipeline.');
          }
          const assessments = evidenceBuilder.build({
            atlas,
            companyName: lead.companyName,
            officialWebsiteUrl: lead.officialWebsiteUrl,
            publicWebResults: lead.publicWebEvidence,
          });
          const preliminaryQualification = qualificationService.evaluate({ atlas, assessments });
          enriched.push({ ...lead, preliminaryQualification });
        }
      }

      return { queries: plan.queries, atlasSourcePaths: plan.atlasSourcePaths, discovered, enriched, proposals };
    },
  };
}

export type LeadAtlasResearchOrchestrator = ReturnType<typeof createLeadAtlasResearchOrchestrator>;
