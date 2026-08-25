import { randomUUID } from 'node:crypto';
import type { AgentRuntimeStore } from './agent-runtime-store.js';
import type { RuntimeExecutionOutcome } from './agent-runtime-orchestrator.js';
import { MARKETING_DRAFT_COPY_CAPABILITY } from './marketing-model-capabilities.js';
import type { MarketingAtlasContextService } from '../services/marketing-atlas-context-service.js';

export interface MarketingRuntimeCommandOrchestrator {
  execute(input: { executionId: string; capabilityId: string }): Promise<RuntimeExecutionOutcome>;
}

export interface MarketingRuntimeCommandDependencies {
  store: Pick<AgentRuntimeStore, 'saveExecution'>;
  orchestrator: MarketingRuntimeCommandOrchestrator;
  atlas: Pick<MarketingAtlasContextService, 'load'>;
}

export interface MarketingDraftRequest {
  brief: string;
  objective?: string;
}

function normalizeText(value: string, field: string, maxLength: number): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} is required.`);
  if (normalized.length > maxLength) throw new Error(`${field} must be at most ${maxLength} characters.`);
  return normalized;
}

export function createMarketingRuntimeCommandService(dependencies: MarketingRuntimeCommandDependencies) {
  return {
    async draft(request: MarketingDraftRequest): Promise<RuntimeExecutionOutcome> {
      const brief = normalizeText(request.brief, 'brief', 4_000);
      const objective = request.objective
        ? normalizeText(request.objective, 'objective', 500)
        : 'Draft Atlas-grounded marketing content for Human Executive review';
      const atlas = await dependencies.atlas.load();
      const packages = [
        atlas.marketingAgent,
        atlas.marketingStrategy,
        atlas.contentStrategy,
        atlas.brandStrategy,
        atlas.brandVoice,
        atlas.idealClientProfile,
      ];
      const context = packages.map((package_) => package_.context).filter(Boolean).join('\n\n');
      const knowledgeReferences = [...new Set(packages.flatMap((package_) =>
        package_.sources.map((source) => source.citation.path)
      ))];
      const id = randomUUID();
      const executionId = `marketing:draft:${id}`;
      const now = new Date().toISOString();
      const record = {
        task: {
          taskId: `task:${executionId}`,
          executionId,
          originAgent: 'human_executive' as const,
          destinationAgent: 'marketing_agent' as const,
          objective,
          priority: 'normal' as const,
          context: { atlasSourceCount: knowledgeReferences.length, publicationAuthorized: false },
          knowledgeReferences,
          inputs: { brief, context },
          expectedOutput: 'One evidence-bounded Marketing draft for Human Executive review',
          dependencies: [],
          risks: [],
          confidence: 1,
          approvalRequired: false,
          status: 'ready' as const,
          nextAction: 'execute_marketing_draft_capability',
          attempt: 1,
          maxAttempts: 1,
          correlationId: executionId,
          createdAt: now,
          updatedAt: now,
        },
        version: 1,
        persistedAt: now,
      };
      await dependencies.store.saveExecution(record, 0);
      return dependencies.orchestrator.execute({
        executionId,
        capabilityId: MARKETING_DRAFT_COPY_CAPABILITY,
      });
    },
  };
}

export type MarketingRuntimeCommandService = ReturnType<typeof createMarketingRuntimeCommandService>;
