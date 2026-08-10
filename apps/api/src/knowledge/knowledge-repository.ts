import type { Pool, PoolClient } from 'pg';
import type { AtlasChunk } from './chunker.js';

export type KnowledgeStatus = 'active' | 'draft' | 'deprecated' | 'archived' | 'superseded';
export type AuthorityLevel = 'critical_policy' | 'authoritative' | 'recommended' | 'reference' | 'example' | 'historical';

export interface KnowledgeDocumentInput {
  documentId: string;
  title: string;
  path: string;
  volume?: string;
  folder?: string;
  documentType: string;
  knowledgeDomain: string;
  status: KnowledgeStatus;
  priority: number;
  authorityLevel: AuthorityLevel;
  allowedAgents: string[];
  applicableTasks: string[];
  serviceTypes: string[];
  technology: string[];
  projectStage: string[];
  securityClassification: 'public' | 'internal' | 'restricted' | 'confidential';
  retrievalWeight: number;
  sourceVersion: string;
  checksum: string;
  lastModified: string;
}

export interface KnowledgeFingerprint {
  documentId: string;
  path: string;
  checksum: string;
  sourceVersion: string;
  status: KnowledgeStatus;
}

export interface IngestionRunInput {
  sourceCommit: string;
  knowledgeRelease: string;
  indexVersion: string;
  chunkingVersion: string;
  metadataSchemaVersion: string;
}

export function createKnowledgeRepository(pool: Pool) {
  async function withTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    let connectionBroken = false;

    const handleClientError = (): void => {
      connectionBroken = true;
    };

    client.on('error', handleClientError);

    try {
      await client.query('begin');
      const result = await work(client);
      await client.query('commit');
      return result;
    } catch (error) {
      if (!connectionBroken) {
        try {
          await client.query('rollback');
        } catch {
          connectionBroken = true;
        }
      }
      throw error;
    } finally {
      client.removeListener('error', handleClientError);
      client.release(connectionBroken);
    }
  }

  return {
    async listDocumentFingerprints(): Promise<KnowledgeFingerprint[]> {
      const result = await pool.query(
        `select document_id, path, checksum, source_version, status
         from knowledge.documents
         order by path asc`,
      );
      return result.rows.map((row) => ({
        documentId: String(row.document_id),
        path: String(row.path),
        checksum: String(row.checksum),
        sourceVersion: String(row.source_version),
        status: row.status as KnowledgeStatus,
      }));
    },

    async createIngestionRun(input: IngestionRunInput): Promise<string> {
      const result = await pool.query(
        `insert into knowledge.ingestion_runs
          (source_commit, knowledge_release, index_version, chunking_version, metadata_schema_version)
         values ($1, $2, $3, $4, $5)
         returning id`,
        [input.sourceCommit, input.knowledgeRelease, input.indexVersion, input.chunkingVersion, input.metadataSchemaVersion],
      );
      return String(result.rows[0]!.id);
    },

    async completeIngestionRun(id: string, documentCount: number, chunkCount: number): Promise<void> {
      await pool.query(
        `update knowledge.ingestion_runs
         set status = 'succeeded', completed_at = now(), document_count = $2, chunk_count = $3, error_summary = null
         where id = $1`,
        [id, documentCount, chunkCount],
      );
    },

    async failIngestionRun(id: string, errorSummary: string): Promise<void> {
      await pool.query(
        `update knowledge.ingestion_runs
         set status = 'failed', completed_at = now(), error_summary = $2
         where id = $1`,
        [id, errorSummary.slice(0, 2000)],
      );
    },

    async replaceDocumentWithChunks(ingestionRunId: string, document: KnowledgeDocumentInput, chunks: AtlasChunk[]): Promise<string> {
      return withTransaction(async (client) => {
        const result = await client.query(
          `insert into knowledge.documents
            (document_id, title, path, volume, folder, document_type, knowledge_domain, status, priority,
             authority_level, allowed_agents, applicable_tasks, service_types, technology, project_stage,
             security_classification, retrieval_weight, source_version, checksum, last_modified, ingestion_run_id)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
           on conflict (document_id) do update set
             title = excluded.title,
             path = excluded.path,
             volume = excluded.volume,
             folder = excluded.folder,
             document_type = excluded.document_type,
             knowledge_domain = excluded.knowledge_domain,
             status = excluded.status,
             priority = excluded.priority,
             authority_level = excluded.authority_level,
             allowed_agents = excluded.allowed_agents,
             applicable_tasks = excluded.applicable_tasks,
             service_types = excluded.service_types,
             technology = excluded.technology,
             project_stage = excluded.project_stage,
             security_classification = excluded.security_classification,
             retrieval_weight = excluded.retrieval_weight,
             source_version = excluded.source_version,
             checksum = excluded.checksum,
             last_modified = excluded.last_modified,
             ingestion_run_id = excluded.ingestion_run_id
           returning id`,
          [
            document.documentId, document.title, document.path, document.volume ?? null, document.folder ?? null,
            document.documentType, document.knowledgeDomain, document.status, document.priority, document.authorityLevel,
            document.allowedAgents, document.applicableTasks, document.serviceTypes, document.technology, document.projectStage,
            document.securityClassification, document.retrievalWeight, document.sourceVersion, document.checksum,
            document.lastModified, ingestionRunId,
          ],
        );

        const databaseDocumentId = String(result.rows[0]!.id);
        await client.query('delete from knowledge.chunks where document_id = $1', [databaseDocumentId]);

        const insertedChunkIds: string[] = [];
        for (const chunk of chunks) {
          const chunkResult = await client.query(
            `insert into knowledge.chunks
              (document_id, chunk_index, heading_path, chunk_type, content, group_id, checksum, token_estimate, metadata)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
             returning id`,
            [
              databaseDocumentId, chunk.index, chunk.headingPath, chunk.kind, chunk.content, chunk.groupId,
              chunk.checksum, chunk.tokenEstimate, JSON.stringify({ previousIndex: chunk.previousIndex, nextIndex: chunk.nextIndex }),
            ],
          );
          insertedChunkIds.push(String(chunkResult.rows[0]!.id));
        }

        for (let index = 0; index < insertedChunkIds.length; index += 1) {
          await client.query(
            `update knowledge.chunks
             set previous_chunk_id = $2, next_chunk_id = $3
             where id = $1`,
            [insertedChunkIds[index], insertedChunkIds[index - 1] ?? null, insertedChunkIds[index + 1] ?? null],
          );
        }

        return databaseDocumentId;
      });
    },
  };
}

export type KnowledgeRepository = ReturnType<typeof createKnowledgeRepository>;
