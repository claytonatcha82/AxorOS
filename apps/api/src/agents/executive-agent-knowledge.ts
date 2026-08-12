import type { KnowledgeContextPackage, KnowledgeContextService } from '../knowledge/knowledge-context-service.js';

export interface ExecutiveAgentKnowledgeRequest {
  objective: string;
  maxCharacters?: number;
}

export interface ExecutiveAgentKnowledgePackage {
  agent: 'executive_agent';
  task: 'executive_strategy';
  objective: string;
  knowledge: KnowledgeContextPackage;
}

const DEFAULT_CONTEXT_CHARACTERS = 10_000;
const MAX_CONTEXT_CHARACTERS = 12_000;
const RETRIEVAL_LIMIT = 8;

export function createExecutiveAgentKnowledgeService(
  contextService: Pick<KnowledgeContextService, 'assemble'>,
) {
  return {
    async prepare(request: ExecutiveAgentKnowledgeRequest): Promise<ExecutiveAgentKnowledgePackage> {
      const objective = request.objective.trim();
      if (!objective) throw new Error('objective is required.');

      const maxCharacters = request.maxCharacters ?? DEFAULT_CONTEXT_CHARACTERS;
      if (!Number.isInteger(maxCharacters) || maxCharacters < 1_000 || maxCharacters > MAX_CONTEXT_CHARACTERS) {
        throw new Error(`maxCharacters must be an integer between 1000 and ${MAX_CONTEXT_CHARACTERS}.`);
      }

      const knowledge = await contextService.assemble({
        query: objective,
        agent: 'executive_agent',
        task: 'executive_strategy',
        maximumSecurityClassification: 'internal',
        limit: RETRIEVAL_LIMIT,
        maxCharacters,
      });

      return { agent: 'executive_agent', task: 'executive_strategy', objective, knowledge };
    },
  };
}

export type ExecutiveAgentKnowledgeService = ReturnType<typeof createExecutiveAgentKnowledgeService>;
