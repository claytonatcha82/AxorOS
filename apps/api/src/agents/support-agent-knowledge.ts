import type { KnowledgeContextRequest, KnowledgeContextService } from '../knowledge/knowledge-context-service.js';

export const SUPPORT_AGENT_KNOWLEDGE_POLICY = {
  agent: 'support_agent', task: 'client_support_and_maintenance', maximumSecurityClassification: 'internal', limit: 8,
  defaultMaxCharacters: 10_000, absoluteMaxCharacters: 12_000,
} as const;

export function createSupportAgentKnowledgeService(contextService: Pick<KnowledgeContextService, 'assemble'>) {
  return {
    async assemble(query: string, maxCharacters: number = SUPPORT_AGENT_KNOWLEDGE_POLICY.defaultMaxCharacters) {
      if (!query.trim()) throw new Error('query is required.');
      if (!Number.isInteger(maxCharacters) || maxCharacters < 1) throw new Error('maxCharacters must be a positive integer.');
      if (maxCharacters > SUPPORT_AGENT_KNOWLEDGE_POLICY.absoluteMaxCharacters) throw new Error('support knowledge context exceeds absolute maximum.');
      const request: KnowledgeContextRequest = { query: query.trim(), agent: SUPPORT_AGENT_KNOWLEDGE_POLICY.agent, task: SUPPORT_AGENT_KNOWLEDGE_POLICY.task, maximumSecurityClassification: SUPPORT_AGENT_KNOWLEDGE_POLICY.maximumSecurityClassification, limit: SUPPORT_AGENT_KNOWLEDGE_POLICY.limit, maxCharacters };
      return contextService.assemble(request);
    },
  };
}
