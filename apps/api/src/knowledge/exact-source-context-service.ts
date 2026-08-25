import type { Pool } from 'pg';
import type { KnowledgeContextPackage, KnowledgeContextSource } from './knowledge-context-service.js';
import type { AuthorityLevel, SecurityClassification } from './knowledge-repository.js';

const SECURITY_ORDER: SecurityClassification[] = ['public', 'internal', 'restricted', 'confidential'];

export interface ExactSourceContextRequest {
  title: string;
  pathPrefix: string;
  agent: string;
  task: string;
  maximumSecurityClassification: SecurityClassification;
  maxCharacters?: number;
}

function normalizeControlledName(value: string, field: string): string {
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (!normalized) throw new Error(`${field} is required.`);
  return normalized;
}

function allowedSecurityLevels(maximum: SecurityClassification): SecurityClassification[] {
  const maximumIndex = SECURITY_ORDER.indexOf(maximum);
  if (maximumIndex < 0) throw new Error(`Invalid maximumSecurityClassification: ${maximum}`);
  return SECURITY_ORDER.slice(0, maximumIndex + 1);
}

function sourceReference(index: number): string {
  return `[ATLAS-${String(index + 1).padStart(2, '0')}]`;
}

export function createExactSourceContextService(pool: Pick<Pool, 'query'>) {
  return {
    async assembleExact(request: ExactSourceContextRequest): Promise<KnowledgeContextPackage> {
      const title = request.title.trim();
      const pathPrefix = request.pathPrefix.trim();
      if (!title) throw new Error('title is required.');
      if (!pathPrefix) throw new Error('pathPrefix is required.');
      const agent = normalizeControlledName(request.agent, 'agent');
      const task = normalizeControlledName(request.task, 'task');
      const maxCharacters = request.maxCharacters ?? 14_000;
      if (!Number.isInteger(maxCharacters) || maxCharacters < 1_000 || maxCharacters > 40_000) {
        throw new Error('maxCharacters must be an integer between 1000 and 40000.');
      }

      const result = await pool.query(
        `select
           c.id as chunk_id,
           d.id as document_id,
           d.document_id as document_key,
           d.title,
           d.path,
           c.heading_path,
           c.chunk_index,
           c.chunk_type,
           c.content,
           d.authority_level,
           d.security_classification,
           d.source_version,
           d.checksum as document_checksum,
           c.checksum as chunk_checksum
         from knowledge.documents d
         join knowledge.chunks c on c.document_id = d.id
         where d.status = 'active'
           and d.title = $1
           and d.path like $2
           and (cardinality(d.allowed_agents) = 0 or $3 = any(d.allowed_agents))
           and (cardinality(d.applicable_tasks) = 0 or $4 = any(d.applicable_tasks))
           and d.security_classification = any($5::text[])
         order by c.chunk_index asc`,
        [title, `${pathPrefix}%`, agent, task, allowedSecurityLevels(request.maximumSecurityClassification)],
      );

      const sections: string[] = [];
      const sources: KnowledgeContextSource[] = [];
      let characterCount = 0;
      let truncated = false;

      for (const row of result.rows as Record<string, unknown>[]) {
        const reference = sourceReference(sources.length);
        const headingPath = Array.isArray(row.heading_path) ? row.heading_path.map(String) : [];
        const heading = headingPath.length > 0 ? ` > ${headingPath.join(' > ')}` : '';
        const rendered = [
          `${reference} ${String(row.title)}${heading}`,
          `Source: ${String(row.path)}`,
          `Authority: ${String(row.authority_level)}`,
          String(row.content).trim(),
        ].join('\n');
        const separatorLength = sections.length > 0 ? 2 : 0;
        if (characterCount + separatorLength + rendered.length > maxCharacters) {
          truncated = true;
          break;
        }

        sections.push(rendered);
        sources.push({
          reference,
          score: 1,
          citation: {
            documentId: String(row.document_id),
            documentKey: String(row.document_key),
            title: String(row.title),
            path: String(row.path),
            headingPath,
            chunkId: String(row.chunk_id),
            chunkIndex: Number(row.chunk_index),
            chunkType: String(row.chunk_type),
            authorityLevel: row.authority_level as AuthorityLevel,
            securityClassification: row.security_classification as SecurityClassification,
            sourceVersion: String(row.source_version),
            documentChecksum: String(row.document_checksum),
            chunkChecksum: String(row.chunk_checksum),
          },
        });
        characterCount += separatorLength + rendered.length;
      }

      if (sources.length < result.rows.length) truncated = true;
      return {
        query: title,
        context: sections.join('\n\n'),
        sources,
        includedItems: sources.length,
        truncated,
        characterCount,
      };
    },
  };
}

export type ExactSourceContextService = ReturnType<typeof createExactSourceContextService>;
