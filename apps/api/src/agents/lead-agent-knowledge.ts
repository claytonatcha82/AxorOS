import type { KnowledgeContextRequest, KnowledgeContextService } from '../knowledge/knowledge-context-service.js';

export const LEAD_AGENT_KNOWLEDGE_POLICY = {
  agent: 'lead_agent',
  task: 'lead_qualification',
  maximumSecurityClassification: 'internal',
  limit: 8,
  defaultMaxCharacters: 10_000,
  absoluteMaxCharacters: 12_000,
} as const;

export function createLeadAgentKnowledgeService(contextService: Pick<KnowledgeContextService, 'assemble'>) {
  return {
    async assemble(query: string, maxCharacters: number = LEAD_AGENT_KNOWLEDGE_POLICY.defaultMaxCharacters) {
      if (!query.trim()) throw new Error('query is required.');
      if (!Number.isInteger(maxCharacters) || maxCharacters < 1_000 || maxCharacters > LEAD_AGENT_KNOWLEDGE_POLICY.absoluteMaxCharacters) {
        throw new Error('lead knowledge context size is invalid.');
      }
      const request: KnowledgeContextRequest = {
        query: query.trim(),
        agent: LEAD_AGENT_KNOWLEDGE_POLICY.agent,
        task: LEAD_AGENT_KNOWLEDGE_POLICY.task,
        maximumSecurityClassification: LEAD_AGENT_KNOWLEDGE_POLICY.maximumSecurityClassification,
        limit: LEAD_AGENT_KNOWLEDGE_POLICY.limit,
        maxCharacters,
      };
      return contextService.assemble(request);
    },
  };
}
