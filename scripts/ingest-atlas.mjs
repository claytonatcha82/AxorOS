import { Pool } from 'pg';
import { createKnowledgeRepository } from '../apps/api/dist/knowledge/knowledge-repository.js';
import { createIncrementalIngestionRunner } from '../apps/api/dist/knowledge/incremental-ingestion-runner.js';

const atlasRoot = process.env.AXOROS_ATLAS_ROOT?.trim();
const databaseUrl = process.env.AXOROS_DATABASE_URL?.trim();
const sourceCommit = process.env.AXOROS_ATLAS_SOURCE_COMMIT?.trim() || 'local-uncommitted';

if (!atlasRoot) {
  console.error('FAIL  AXOROS_ATLAS_ROOT is not set');
  process.exit(1);
}
if (!databaseUrl) {
  console.error('FAIL  AXOROS_DATABASE_URL is not set');
  process.exit(1);
}

const pool = new Pool({ connectionString: databaseUrl, max: 2, connectionTimeoutMillis: 5000 });
try {
  const repository = createKnowledgeRepository(pool);
  const runner = createIncrementalIngestionRunner(repository);
  const result = await runner.run({
    atlasRoot,
    sourceCommit,
    knowledgeRelease: process.env.AXOROS_KNOWLEDGE_RELEASE?.trim() || 'pilot-dev',
    indexVersion: 'knowledge-v1',
    chunkingVersion: 'structure-v1',
    metadataSchemaVersion: 'metadata-v1',
  });

  console.log(`PASS  Atlas discovery: ${result.discovered} Markdown files`);
  console.log(`INFO  Added: ${result.added}`);
  console.log(`INFO  Changed: ${result.changed}`);
  console.log(`INFO  Unchanged: ${result.unchanged}`);
  console.log(`INFO  Missing from source: ${result.missingFromSource}`);
  console.log(`PASS  Ingested documents: ${result.ingestedDocuments}`);
  console.log(`PASS  Ingested chunks: ${result.ingestedChunks}`);
  if (result.runId) console.log(`INFO  Ingestion run: ${result.runId}`);
} finally {
  await pool.end();
}
