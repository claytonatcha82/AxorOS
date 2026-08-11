import type { KnowledgeContextPackage, KnowledgeContextService } from '../knowledge/knowledge-context-service.js';

export interface SalesAgentKnowledgeRequest {
  objective: string;
  maxCharacters?: number;
}

export interface SalesAgentKnowledgePackage {
  agent: 'sales_agent';
  task: 'sales_conversion';
  objective: string;
  knowledge: KnowledgeContextPackage;
}

const DEFAULT_AGENT_CONTEXT_CHARACTERS = 10_000;
const MAX_AGENT_CONTEXT_CHARACTERS = 12_000;
const RETRIEVAL_LIMIT = 8;

export function createSalesAgentKnowledgeService(contextService: Pick<KnowledgeContextService, 'assemble'>) {
  return {
    async prepare(request: SalesAgentKnowledgeRequest): Promise<SalesAgentKnowledgePackage> {
      const objective = request.objective.trim();
      if (!objective) throw new Error('objective is required.');

      const maxCharacters = request.maxCharacters ?? DEFAULT_AGENT_CONTEXT_CHARACTERS;
      if (!Number.isInteger(maxCharacters) || maxCharacters < 1_000 || maxCharacters > MAX_AGENT_CONTEXT_CHARACTERS) {
        throw new Error(`maxCharacters must be an integer between 1000 and ${MAX_AGENT_CONTEXT_CHARACTERS}.`);
      }

      const knowledge = await contextService.assemble({
        query: objective,
        agent: 'sales_agent',
        task: 'sales_conversion',
        maximumSecurityClassification: 'internal',
        limit: RETRIEVAL_LIMIT,
        maxCharacters,
      });

      return { agent: 'sales_agent', task: 'sales_conversion', objective, knowledge };
    },
  };
}

export type SalesAgentKnowledgeService = ReturnType<typeof createSalesAgentKnowledgeService>;
