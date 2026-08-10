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

const pool = new Pool({
  connectionString: databaseUrl,
  max: 2,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  statement_timeout: 300_000,
  lock_timeout: 30_000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10_000,
  application_name: 'axoros-atlas-ingestion',
});

pool.on('error', (error) => {
  // node-postgres automatically removes a failed idle client from the pool.
  // Handling the event prevents a transient backend/network disconnect from
  // becoming an uncaught EventEmitter error that terminates the ingestion CLI.
  console.warn(`WARN  PostgreSQL idle connection dropped; pool will reconnect on demand: ${error.message}`);
});

const transientDatabaseCodes = new Set([
  '08000',
  '08001',
  '08003',
  '08004',
  '08006',
  '08007',
  '08P01',
  '57P01',
  '57P02',
  '57P03',
]);

function isTransientDatabaseError(error) {
  const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code ?? '') : '';
  if (transientDatabaseCodes.has(code)) return true;

  const message = error instanceof Error ? error.message : String(error);
  return /connection terminated|connection reset|socket hang up|econnreset|econnrefused|etimedout|server closed the connection unexpectedly/i.test(message);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runWithTransientRetry(runner, input, maxAttempts = 3) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await runner.run(input);
    } catch (error) {
      if (!isTransientDatabaseError(error) || attempt === maxAttempts) throw error;

      const message = error instanceof Error ? error.message : String(error);
      const backoffMs = 750 * attempt;
      console.warn(`WARN  PostgreSQL connection interrupted (attempt ${attempt}/${maxAttempts}): ${message}`);
      console.warn(`INFO  Retrying Atlas ingestion in ${backoffMs}ms with a fresh pooled connection`);
      await delay(backoffMs);
    }
  }

  throw new Error('Atlas ingestion retry loop exited unexpectedly.');
}

try {
  const timeoutResult = await pool.query('show statement_timeout');
  const lockTimeoutResult = await pool.query('show lock_timeout');
  console.log(`INFO  PostgreSQL statement_timeout: ${timeoutResult.rows[0]?.statement_timeout ?? 'unknown'}`);
  console.log(`INFO  PostgreSQL lock_timeout: ${lockTimeoutResult.rows[0]?.lock_timeout ?? 'unknown'}`);

  const repository = createKnowledgeRepository(pool);
  const runner = createIncrementalIngestionRunner(repository);
  const result = await runWithTransientRetry(runner, {
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
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`FAIL  Atlas ingestion failed: ${message}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
