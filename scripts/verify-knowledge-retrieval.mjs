import { Pool } from 'pg';
import { createKnowledgeRepository } from '../apps/api/dist/knowledge/knowledge-repository.js';
import { createKnowledgeRetrievalService } from '../apps/api/dist/knowledge/knowledge-retrieval-service.js';

const databaseUrl = process.env.AXOROS_DATABASE_URL?.trim();

if (!databaseUrl) {
  console.error('FAIL  AXOROS_DATABASE_URL is not set');
  process.exit(1);
}

const pool = new Pool({
  connectionString: databaseUrl,
  max: 1,
  idleTimeoutMillis: 15_000,
  connectionTimeoutMillis: 30_000,
  keepAlive: true,
  application_name: 'axoros-knowledge-retrieval-verification',
});

pool.on('error', (error) => {
  console.warn(`WARN  PostgreSQL idle connection dropped during retrieval verification: ${error.message}`);
});

const queries = [
  process.env.AXOROS_KNOWLEDGE_VERIFY_QUERY?.trim(),
  'website',
  'development',
  'client',
  'design',
].filter((value, index, values) => value && values.indexOf(value) === index);

try {
  const counts = await pool.query(
    `select
       (select count(*)::int from knowledge.documents) as documents,
       (select count(*)::int from knowledge.documents where status = 'active') as active_documents,
       (select count(*)::int from knowledge.chunks) as chunks`,
  );

  const snapshot = counts.rows[0];
  const documents = Number(snapshot?.documents ?? 0);
  const activeDocuments = Number(snapshot?.active_documents ?? 0);
  const chunks = Number(snapshot?.chunks ?? 0);

  if (documents < 1 || activeDocuments < 1 || chunks < 1) {
    throw new Error(`Knowledge index is empty or unusable: documents=${documents}, active=${activeDocuments}, chunks=${chunks}`);
  }

  console.log(`PASS  Knowledge index present: ${documents} documents, ${activeDocuments} active, ${chunks} chunks`);

  const repository = createKnowledgeRepository(pool);
  const retrieval = createKnowledgeRetrievalService(repository);

  let selectedQuery;
  let results = [];

  for (const query of queries) {
    const candidateResults = await retrieval.retrieve({
      query,
      agent: 'production_agent',
      task: 'website_development',
      maximumSecurityClassification: 'internal',
      limit: 5,
    });

    console.log(`INFO  Retrieval query "${query}": ${candidateResults.length} result(s)`);
    if (candidateResults.length > 0) {
      selectedQuery = query;
      results = candidateResults;
      break;
    }
  }

  if (!selectedQuery || results.length === 0) {
    throw new Error('Controlled retrieval returned no results for the verification query set.');
  }

  for (const [index, item] of results.slice(0, 3).entries()) {
    const citation = item.citation;
    if (!citation.path || !citation.chunkId || !citation.documentChecksum || !citation.chunkChecksum || !citation.sourceVersion) {
      throw new Error(`Retrieval result ${index + 1} is missing required provenance.`);
    }
    if (!['public', 'internal'].includes(citation.securityClassification)) {
      throw new Error(`Retrieval result ${index + 1} exceeded the internal security ceiling.`);
    }

    const heading = citation.headingPath.length > 0 ? ` > ${citation.headingPath.join(' > ')}` : '';
    console.log(`PASS  Result ${index + 1}: ${citation.path}${heading}`);
    console.log(`INFO  Authority=${citation.authorityLevel} Security=${citation.securityClassification} Score=${item.score.toFixed(6)}`);
  }

  console.log(`PASS  Controlled knowledge retrieval verified with query: ${selectedQuery}`);
  console.log(`PASS  Provenance verified for ${Math.min(results.length, 3)} result(s)`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`FAIL  Knowledge retrieval verification failed: ${message}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
