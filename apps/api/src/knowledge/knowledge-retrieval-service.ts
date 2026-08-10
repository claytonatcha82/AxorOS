import type {
  AuthorityLevel,
  KnowledgeRepository,
  KnowledgeSearchResult,
  SecurityClassification,
} from './knowledge-repository.js';

const securityOrder: SecurityClassification[] = ['public', 'internal', 'restricted', 'confidential'];

export interface KnowledgeRetrievalRequest {
  query: string;
  agent: string;
  task: string;
  maximumSecurityClassification: SecurityClassification;
  limit?: number;
}

export interface KnowledgeCitation {
  documentId: string;
  documentKey: string;
  title: string;
  path: string;
  headingPath: string[];
  chunkId: string;
  chunkIndex: number;
  chunkType: string;
  authorityLevel: AuthorityLevel;
  securityClassification: SecurityClassification;
  sourceVersion: string;
  documentChecksum: string;
  chunkChecksum: string;
}

export interface KnowledgeRetrievalItem {
  content: string;
  score: number;
  citation: KnowledgeCitation;
}

function normalizeControlledName(value: string, field: string): string {
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (!normalized) throw new Error(`${field} is required.`);
  return normalized;
}

function allowedSecurityLevels(maximum: SecurityClassification): SecurityClassification[] {
  const maximumIndex = securityOrder.indexOf(maximum);
  if (maximumIndex < 0) throw new Error(`Invalid maximumSecurityClassification: ${maximum}`);
  return securityOrder.slice(0, maximumIndex + 1);
}

function toRetrievalItem(result: KnowledgeSearchResult): KnowledgeRetrievalItem {
  return {
    content: result.content,
    score: result.score,
    citation: {
      documentId: result.documentId,
      documentKey: result.documentKey,
      title: result.title,
      path: result.path,
      headingPath: result.headingPath,
      chunkId: result.chunkId,
      chunkIndex: result.chunkIndex,
      chunkType: result.chunkType,
      authorityLevel: result.authorityLevel,
      securityClassification: result.securityClassification,
      sourceVersion: result.sourceVersion,
      documentChecksum: result.documentChecksum,
      chunkChecksum: result.chunkChecksum,
    },
  };
}

export function createKnowledgeRetrievalService(repository: Pick<KnowledgeRepository, 'searchKnowledge'>) {
  return {
    async retrieve(request: KnowledgeRetrievalRequest): Promise<KnowledgeRetrievalItem[]> {
      const query = request.query.trim();
      if (!query) throw new Error('query is required.');

      const agent = normalizeControlledName(request.agent, 'agent');
      const task = normalizeControlledName(request.task, 'task');
      const limit = request.limit ?? 10;

      if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
        throw new Error('limit must be an integer between 1 and 50.');
      }

      const results = await repository.searchKnowledge({
        query,
        agent,
        task,
        allowedSecurityClassifications: allowedSecurityLevels(request.maximumSecurityClassification),
        limit,
      });

      return results.map(toRetrievalItem);
    },
  };
}

export type KnowledgeRetrievalService = ReturnType<typeof createKnowledgeRetrievalService>;
