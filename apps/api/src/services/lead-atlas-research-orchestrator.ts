import type { LeadAtlasContextService } from './lead-atlas-context-service.js';
import type { LeadAtlasResearchPlanner } from './lead-atlas-research-planner.js';
import type { LeadResearchWorkflowOutput, LeadResearchWorkflowService } from './lead-research-workflow-service.js';

export interface AtlasLeadResearchInput {
  geographicFocus?: string;
  country?: string;
  maxQueries?: number;
  maxBusinessesPerQuery?: number;
  maxWebResultsPerBusiness?: number;
  executionId: string;
  correlationId: string;
}

export interface AtlasLeadResearchOutput {
  queries: string[];
  atlasSourcePaths: string[];
  discovered: number;
  enriched: LeadResearchWorkflowOutput['enriched'];
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
) {
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

      const enriched: LeadResearchWorkflowOutput['enriched'] = [];
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
        enriched.push(...result.enriched);
        proposals.push(...result.proposals);
      }

      return { queries: plan.queries, atlasSourcePaths: plan.atlasSourcePaths, discovered, enriched, proposals };
    },
  };
}

export type LeadAtlasResearchOrchestrator = ReturnType<typeof createLeadAtlasResearchOrchestrator>;
