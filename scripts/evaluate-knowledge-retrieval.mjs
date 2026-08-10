import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { createKnowledgeRepository } from '../apps/api/dist/knowledge/knowledge-repository.js';
import { createKnowledgeRetrievalService } from '../apps/api/dist/knowledge/knowledge-retrieval-service.js';

const databaseUrl = process.env.AXOROS_DATABASE_URL?.trim();
if (!databaseUrl) {
  console.error('FAIL  AXOROS_DATABASE_URL is not set');
  process.exit(1);
}

const suite = JSON.parse(await readFile(new URL('../evaluation/knowledge-retrieval-cases.json', import.meta.url), 'utf8'));
const cases = Array.isArray(suite.cases) ? suite.cases : [];
const minimumHitRate = Number(suite.minimumHitRate ?? 1);

if (cases.length === 0) {
  console.error('FAIL  Knowledge retrieval evaluation suite has no cases');
  process.exit(1);
}

const pool = new Pool({
  connectionString: databaseUrl,
  max: 1,
  idleTimeoutMillis: 15_000,
  connectionTimeoutMillis: 30_000,
  keepAlive: true,
  application_name: 'axoros-knowledge-retrieval-evaluation',
});

pool.on('error', (error) => {
  console.warn(`WARN  PostgreSQL idle connection dropped during retrieval evaluation: ${error.message}`);
});

function resultIdentity(item) {
  return `${item.citation.chunkId}:${item.citation.chunkChecksum}`;
}

try {
  const repository = createKnowledgeRepository(pool);
  const retrieval = createKnowledgeRetrievalService(repository);
  let hitCases = 0;
  let provenanceFailures = 0;
  let policyFailures = 0;
  let determinismFailures = 0;

  for (const evaluationCase of cases) {
    const request = {
      query: String(evaluationCase.query),
      agent: String(evaluationCase.agent),
      task: String(evaluationCase.task),
      maximumSecurityClassification: String(evaluationCase.maximumSecurityClassification),
      limit: Number(evaluationCase.limit ?? 5),
    };

    const first = await retrieval.retrieve(request);
    const second = await retrieval.retrieve(request);
    const minimumResults = Number(evaluationCase.minimumResults ?? 1);
    const hit = first.length >= minimumResults;
    if (hit) hitCases += 1;

    const firstIds = first.map(resultIdentity);
    const secondIds = second.map(resultIdentity);
    const deterministic = JSON.stringify(firstIds) === JSON.stringify(secondIds);
    if (!deterministic) determinismFailures += 1;

    for (const item of first) {
      const citation = item.citation;
      if (!citation.path || !citation.chunkId || !citation.documentChecksum || !citation.chunkChecksum || !citation.sourceVersion) {
        provenanceFailures += 1;
      }
      if (!['public', 'internal'].includes(citation.securityClassification)) {
        policyFailures += 1;
      }
    }

    console.log(`${hit ? 'PASS' : 'WARN'}  ${evaluationCase.name}: ${first.length} result(s), deterministic=${deterministic}`);
  }

  const hitRate = hitCases / cases.length;
  console.log(`INFO  Retrieval hit rate: ${(hitRate * 100).toFixed(1)}% (${hitCases}/${cases.length})`);
  console.log(`INFO  Determinism failures: ${determinismFailures}`);
  console.log(`INFO  Provenance failures: ${provenanceFailures}`);
  console.log(`INFO  Policy failures: ${policyFailures}`);

  if (hitRate < minimumHitRate) {
    throw new Error(`Retrieval hit rate ${(hitRate * 100).toFixed(1)}% is below required ${(minimumHitRate * 100).toFixed(1)}%`);
  }
  if (determinismFailures > 0) throw new Error(`Detected ${determinismFailures} non-deterministic retrieval case(s)`);
  if (provenanceFailures > 0) throw new Error(`Detected ${provenanceFailures} provenance failure(s)`);
  if (policyFailures > 0) throw new Error(`Detected ${policyFailures} security policy failure(s)`);

  console.log('PASS  Knowledge retrieval evaluation passed');
  console.log('PASS  PostgreSQL full-text retrieval remains suitable for the current pilot baseline');
} catch (error) {
  console.error(`FAIL  Knowledge retrieval evaluation failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
