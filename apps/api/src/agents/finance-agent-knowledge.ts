import type { KnowledgeContextRequest, KnowledgeContextService } from '../knowledge/knowledge-context-service.js';

export const FINANCE_AGENT_KNOWLEDGE_POLICY = {
  agent: 'finance_agent',
  task: 'financial_policy_and_operations',
  maximumSecurityClassification: 'internal',
  limit: 8,
  defaultMaxCharacters: 10_000,
  absoluteMaxCharacters: 12_000,
} as const;

export function createFinanceAgentKnowledgeService(contextService: Pick<KnowledgeContextService, 'assemble'>) {
  return {
    async assemble(query: string, maxCharacters: number = FINANCE_AGENT_KNOWLEDGE_POLICY.defaultMaxCharacters) {
      if (!query.trim()) throw new Error('query is required.');
      if (!Number.isInteger(maxCharacters) || maxCharacters < 1) throw new Error('maxCharacters must be a positive integer.');
      if (maxCharacters > FINANCE_AGENT_KNOWLEDGE_POLICY.absoluteMaxCharacters) throw new Error('finance knowledge context exceeds absolute maximum.');
      const request: KnowledgeContextRequest = {
        query: query.trim(), agent: FINANCE_AGENT_KNOWLEDGE_POLICY.agent, task: FINANCE_AGENT_KNOWLEDGE_POLICY.task,
        maximumSecurityClassification: FINANCE_AGENT_KNOWLEDGE_POLICY.maximumSecurityClassification,
        limit: FINANCE_AGENT_KNOWLEDGE_POLICY.limit, maxCharacters,
      };
      return contextService.assemble(request);
    },
  };
}
