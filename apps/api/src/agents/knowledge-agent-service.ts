import type { KnowledgeContextRequest, KnowledgeContextService } from '../knowledge/knowledge-context-service.js';

export interface KnowledgeAgentServiceRequest {
  requestingAgent: string;
  task: string;
  query: string;
  requiredContext: string[];
  maximumSecurityClassification: KnowledgeContextRequest['maximumSecurityClassification'];
  limit?: number;
  maxCharacters?: number;
}

export function createKnowledgeAgentService(contextService: Pick<KnowledgeContextService, 'assemble'>) {
  return {
    async retrieveContext(request: KnowledgeAgentServiceRequest) {
      if (!request.requestingAgent.trim()) throw new Error('requestingAgent is required.');
      if (!request.task.trim()) throw new Error('task is required.');
      if (!request.query.trim()) throw new Error('query is required.');
      if (request.requiredContext.length === 0 || request.requiredContext.some((item) => !item.trim())) {
        throw new Error('requiredContext must contain at least one non-blank knowledge domain.');
      }

      const domainQuery = request.requiredContext.join(' ');
      const contextRequest: KnowledgeContextRequest = {
        query: `${request.query.trim()} ${domainQuery}`.trim(),
        agent: request.requestingAgent,
        task: request.task,
        maximumSecurityClassification: request.maximumSecurityClassification,
        ...(request.limit === undefined ? {} : { limit: request.limit }),
        ...(request.maxCharacters === undefined ? {} : { maxCharacters: request.maxCharacters }),
      };

      return contextService.assemble(contextRequest);
    },
  };
}

export type KnowledgeAgentService = ReturnType<typeof createKnowledgeAgentService>;
