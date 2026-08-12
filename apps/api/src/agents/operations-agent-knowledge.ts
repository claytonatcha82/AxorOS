import type { KnowledgeContextRequest, KnowledgeContextService } from '../knowledge/knowledge-context-service.js';

export const OPERATIONS_AGENT_KNOWLEDGE_POLICY = {
  agent: 'operations_agent',
  task: 'workflow_orchestration',
  maximumSecurityClassification: 'internal',
  limit: 8,
  defaultMaxCharacters: 10_000,
  absoluteMaxCharacters: 12_000,
} as const;

export function createOperationsAgentKnowledgeService(contextService: Pick<KnowledgeContextService, 'assemble'>) {
  return {
    async assemble(query: string, maxCharacters = OPERATIONS_AGENT_KNOWLEDGE_POLICY.defaultMaxCharacters) {
      if (!query.trim()) throw new Error('query is required.');
      if (maxCharacters > OPERATIONS_AGENT_KNOWLEDGE_POLICY.absoluteMaxCharacters) throw new Error('operations knowledge context exceeds absolute maximum.');
      const request: KnowledgeContextRequest = {
        query: query.trim(),
        agent: OPERATIONS_AGENT_KNOWLEDGE_POLICY.agent,
        task: OPERATIONS_AGENT_KNOWLEDGE_POLICY.task,
        maximumSecurityClassification: OPERATIONS_AGENT_KNOWLEDGE_POLICY.maximumSecurityClassification,
        limit: OPERATIONS_AGENT_KNOWLEDGE_POLICY.limit,
        maxCharacters,
      };
      return contextService.assemble(request);
    },
  };
}
