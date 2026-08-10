import { readFile } from 'node:fs/promises';
import type { KnowledgeRepository } from './knowledge-repository.js';
import { createKnowledgeIngestionService } from './knowledge-ingestion-service.js';
import { detectAtlasChanges, discoverAtlasMarkdown } from './source-acquisition.js';

export interface IncrementalIngestionInput {
  atlasRoot: string;
  sourceCommit: string;
  knowledgeRelease: string;
  indexVersion: string;
  chunkingVersion: string;
  metadataSchemaVersion: string;
}

export interface IncrementalIngestionResult {
  discovered: number;
  added: number;
  changed: number;
  unchanged: number;
  missingFromSource: number;
  ingestedDocuments: number;
  ingestedChunks: number;
  runId?: string;
}

export function createIncrementalIngestionRunner(repository: KnowledgeRepository) {
  const ingestionService = createKnowledgeIngestionService(repository);

  return {
    async run(input: IncrementalIngestionInput): Promise<IncrementalIngestionResult> {
      const sourceFiles = await discoverAtlasMarkdown(input.atlasRoot);
      const existing = await repository.listDocumentFingerprints();
      const changes = detectAtlasChanges(sourceFiles, existing);
      const candidates = [...changes.added, ...changes.changed].sort((a, b) => a.relativePath.localeCompare(b.relativePath));

      if (candidates.length === 0) {
        return {
          discovered: sourceFiles.length,
          added: changes.added.length,
          changed: changes.changed.length,
          unchanged: changes.unchanged.length,
          missingFromSource: changes.missingFromSource.length,
          ingestedDocuments: 0,
          ingestedChunks: 0,
        };
      }

      const documents = await Promise.all(candidates.map(async (file) => ({
        path: file.relativePath,
        markdown: await readFile(file.absolutePath, 'utf8'),
        lastModified: file.lastModified,
      })));

      const result = await ingestionService.ingestRelease({
        sourceCommit: input.sourceCommit,
        knowledgeRelease: input.knowledgeRelease,
        indexVersion: input.indexVersion,
        chunkingVersion: input.chunkingVersion,
        metadataSchemaVersion: input.metadataSchemaVersion,
        documents,
      });

      return {
        discovered: sourceFiles.length,
        added: changes.added.length,
        changed: changes.changed.length,
        unchanged: changes.unchanged.length,
        missingFromSource: changes.missingFromSource.length,
        ingestedDocuments: result.documentCount,
        ingestedChunks: result.chunkCount,
        runId: result.runId,
      };
    },
  };
}
