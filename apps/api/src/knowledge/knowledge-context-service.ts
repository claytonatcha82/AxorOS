import type {
  KnowledgeCitation,
  KnowledgeRetrievalItem,
  KnowledgeRetrievalRequest,
  KnowledgeRetrievalService,
} from './knowledge-retrieval-service.js';

export interface KnowledgeContextRequest extends KnowledgeRetrievalRequest {
  maxCharacters?: number;
}

export interface KnowledgeContextSource {
  reference: string;
  citation: KnowledgeCitation;
  score: number;
}

export interface KnowledgeContextPackage {
  query: string;
  context: string;
  sources: KnowledgeContextSource[];
  includedItems: number;
  truncated: boolean;
  characterCount: number;
}

const DEFAULT_MAX_CHARACTERS = 12_000;
const MAX_MAX_CHARACTERS = 40_000;

function sourceReference(index: number): string {
  return `[ATLAS-${String(index + 1).padStart(2, '0')}]`;
}

function renderItem(item: KnowledgeRetrievalItem, reference: string): string {
  const heading = item.citation.headingPath.length > 0
    ? ` > ${item.citation.headingPath.join(' > ')}`
    : '';

  return [
    `${reference} ${item.citation.title}${heading}`,
    `Source: ${item.citation.path}`,
    `Authority: ${item.citation.authorityLevel}`,
    item.content.trim(),
  ].join('\n');
}

export function createKnowledgeContextService(retrieval: Pick<KnowledgeRetrievalService, 'retrieve'>) {
  return {
    async assemble(request: KnowledgeContextRequest): Promise<KnowledgeContextPackage> {
      const maxCharacters = request.maxCharacters ?? DEFAULT_MAX_CHARACTERS;
      if (!Number.isInteger(maxCharacters) || maxCharacters < 1_000 || maxCharacters > MAX_MAX_CHARACTERS) {
        throw new Error(`maxCharacters must be an integer between 1000 and ${MAX_MAX_CHARACTERS}.`);
      }

      const results = await retrieval.retrieve(request);
      const sections: string[] = [];
      const sources: KnowledgeContextSource[] = [];
      let characterCount = 0;
      let truncated = false;

      for (const item of results) {
        const reference = sourceReference(sources.length);
        const rendered = renderItem(item, reference);
        const separatorLength = sections.length > 0 ? 2 : 0;

        if (characterCount + separatorLength + rendered.length > maxCharacters) {
          truncated = true;
          break;
        }

        sections.push(rendered);
        sources.push({ reference, citation: item.citation, score: item.score });
        characterCount += separatorLength + rendered.length;
      }

      if (sources.length < results.length) truncated = true;

      return {
        query: request.query.trim(),
        context: sections.join('\n\n'),
        sources,
        includedItems: sources.length,
        truncated,
        characterCount,
      };
    },
  };
}

export type KnowledgeContextService = ReturnType<typeof createKnowledgeContextService>;
