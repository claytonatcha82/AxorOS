import type { KnowledgeContextPackage, KnowledgeContextService } from '../knowledge/knowledge-context-service.js';

export interface ProductionAgentKnowledgeRequest {
  objective: string;
  maxCharacters?: number;
}

export interface ProductionAgentKnowledgePackage {
  agent: 'production_agent';
  task: 'website_development';
  objective: string;
  knowledge: KnowledgeContextPackage;
}

const DEFAULT_AGENT_CONTEXT_CHARACTERS = 12_000;
const MAX_AGENT_CONTEXT_CHARACTERS = 12_000;
const RETRIEVAL_LIMIT = 8;

export function createProductionAgentKnowledgeService(
  contextService: Pick<KnowledgeContextService, 'assemble'>,
) {
  return {
    async prepare(request: ProductionAgentKnowledgeRequest): Promise<ProductionAgentKnowledgePackage> {
      const objective = request.objective.trim();
      if (!objective) throw new Error('objective is required.');

      const maxCharacters = request.maxCharacters ?? DEFAULT_AGENT_CONTEXT_CHARACTERS;
      if (!Number.isInteger(maxCharacters) || maxCharacters < 1_000 || maxCharacters > MAX_AGENT_CONTEXT_CHARACTERS) {
        throw new Error(`maxCharacters must be an integer between 1000 and ${MAX_AGENT_CONTEXT_CHARACTERS}.`);
      }

      const knowledge = await contextService.assemble({
        query: objective,
        agent: 'production_agent',
        task: 'website_development',
        maximumSecurityClassification: 'internal',
        limit: RETRIEVAL_LIMIT,
        maxCharacters,
      });

      return {
        agent: 'production_agent',
        task: 'website_development',
        objective,
        knowledge,
      };
    },
  };
}

export type ProductionAgentKnowledgeService = ReturnType<typeof createProductionAgentKnowledgeService>;
