import type { KnowledgeContextRequest, KnowledgeContextService } from '../knowledge/knowledge-context-service.js';

export const MARKETING_AGENT_KNOWLEDGE_POLICY = {
  agent: 'marketing_agent', task: 'brand_growth_and_inbound_demand', maximumSecurityClassification: 'internal', limit: 10,
  defaultMaxCharacters: 12_000, absoluteMaxCharacters: 15_000,
} as const;

export function createMarketingAgentKnowledgeService(contextService: Pick<KnowledgeContextService, 'assemble'>) {
  return {
    async assemble(query: string, maxCharacters: number = MARKETING_AGENT_KNOWLEDGE_POLICY.defaultMaxCharacters) {
      if (!query.trim()) throw new Error('query is required.');
      if (!Number.isInteger(maxCharacters) || maxCharacters < 1) throw new Error('maxCharacters must be a positive integer.');
      if (maxCharacters > MARKETING_AGENT_KNOWLEDGE_POLICY.absoluteMaxCharacters) throw new Error('marketing knowledge context exceeds absolute maximum.');
      const request: KnowledgeContextRequest = { query: query.trim(), agent: MARKETING_AGENT_KNOWLEDGE_POLICY.agent, task: MARKETING_AGENT_KNOWLEDGE_POLICY.task, maximumSecurityClassification: MARKETING_AGENT_KNOWLEDGE_POLICY.maximumSecurityClassification, limit: MARKETING_AGENT_KNOWLEDGE_POLICY.limit, maxCharacters };
      return contextService.assemble(request);
    },
  };
}
