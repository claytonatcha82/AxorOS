import { chunkAtlasDocument } from './chunker.js';
import { parseAtlasMarkdown } from './markdown-parser.js';
import type { KnowledgeRepository, KnowledgeDocumentInput, KnowledgeStatus, AuthorityLevel } from './knowledge-repository.js';

const statuses = new Set<KnowledgeStatus>(['active','draft','deprecated','archived','superseded']);
const authorities = new Set<AuthorityLevel>(['critical_policy','authoritative','recommended','reference','example','historical']);
const securityClassifications = new Set<KnowledgeDocumentInput['securityClassification']>(['public','internal','restricted','confidential']);

function stringValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function normalizedControlledValue(value: unknown, fallback: string): string {
  const raw = stringValue(value, fallback);
  return raw
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean) : [];
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function inferTitle(sourcePath: string, body: string): string {
  const heading = body.split('\n').find((line) => /^#\s+/.test(line));
  if (heading) return heading.replace(/^#\s+/, '').trim();
  const filename = sourcePath.split(/[\\/]/).pop() ?? sourcePath;
  return filename.replace(/\.md$/i, '');
}

function buildDocumentInput(sourcePath: string, sourceVersion: string, lastModified: string, markdown: string): { document: KnowledgeDocumentInput; chunks: ReturnType<typeof chunkAtlasDocument> } {
  const parsed = parseAtlasMarkdown(sourcePath, markdown);
  const metadata = parsed.metadata;
  const statusRaw = normalizedControlledValue(metadata.status, 'active') as KnowledgeStatus;
  const authorityRaw = normalizedControlledValue(metadata.authority_level, 'reference') as AuthorityLevel;
  const securityClassification = normalizedControlledValue(metadata.security_classification, 'internal') as KnowledgeDocumentInput['securityClassification'];

  if (!statuses.has(statusRaw)) throw new Error(`Invalid knowledge status: ${stringValue(metadata.status, 'active')}`);
  if (!authorities.has(authorityRaw)) throw new Error(`Invalid authority_level: ${stringValue(metadata.authority_level, 'reference')}`);
  if (!securityClassifications.has(securityClassification)) {
    throw new Error(`Invalid security_classification: ${stringValue(metadata.security_classification, 'internal')}`);
  }

  const document: KnowledgeDocumentInput = {
    documentId: stringValue(metadata.document_id, parsed.checksum.slice(0, 24)),
    title: stringValue(metadata.title, inferTitle(sourcePath, parsed.body)),
    path: sourcePath,
    ...(stringValue(metadata.volume) ? { volume: stringValue(metadata.volume) } : {}),
    ...(stringValue(metadata.folder) ? { folder: stringValue(metadata.folder) } : {}),
    documentType: normalizedControlledValue(metadata.document_type, 'reference'),
    knowledgeDomain: normalizedControlledValue(metadata.knowledge_domain, 'general'),
    status: statusRaw,
    priority: Math.max(0, Math.min(100, Math.round(numberValue(metadata.priority, 50)))),
    authorityLevel: authorityRaw,
    allowedAgents: stringArray(metadata.allowed_agents).map((item) => normalizedControlledValue(item, item)),
    applicableTasks: stringArray(metadata.applicable_tasks).map((item) => normalizedControlledValue(item, item)),
    serviceTypes: stringArray(metadata.service_types).map((item) => normalizedControlledValue(item, item)),
    technology: stringArray(metadata.technology).map((item) => normalizedControlledValue(item, item)),
    projectStage: stringArray(metadata.project_stage).map((item) => normalizedControlledValue(item, item)),
    securityClassification,
    retrievalWeight: numberValue(metadata.retrieval_weight, 1),
    sourceVersion,
    checksum: parsed.checksum,
    lastModified,
  };

  if (!(document.retrievalWeight > 0)) throw new Error('retrieval_weight must be greater than zero.');

  return { document, chunks: chunkAtlasDocument(parsed) };
}

export interface AtlasSourceDocument {
  path: string;
  markdown: string;
  lastModified: string;
}

export interface KnowledgeReleaseInput {
  sourceCommit: string;
  knowledgeRelease: string;
  indexVersion: string;
  chunkingVersion: string;
  metadataSchemaVersion: string;
  documents: AtlasSourceDocument[];
}

export function createKnowledgeIngestionService(repository: KnowledgeRepository) {
  return {
    async ingestRelease(input: KnowledgeReleaseInput) {
      if (!input.sourceCommit.trim()) throw new Error('sourceCommit is required.');
      if (!input.knowledgeRelease.trim()) throw new Error('knowledgeRelease is required.');

      const runId = await repository.createIngestionRun(input);
      let chunkCount = 0;
      try {
        for (const source of input.documents) {
          const prepared = buildDocumentInput(source.path, input.sourceCommit, source.lastModified, source.markdown);
          await repository.replaceDocumentWithChunks(runId, prepared.document, prepared.chunks);
          chunkCount += prepared.chunks.length;
        }
        await repository.completeIngestionRun(runId, input.documents.length, chunkCount);
        return { runId, documentCount: input.documents.length, chunkCount };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await repository.failIngestionRun(runId, message);
        throw error;
      }
    },
  };
}
