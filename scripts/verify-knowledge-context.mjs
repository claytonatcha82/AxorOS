import { Pool } from 'pg';
import { createKnowledgeRepository } from '../apps/api/dist/knowledge/knowledge-repository.js';
import { createKnowledgeRetrievalService } from '../apps/api/dist/knowledge/knowledge-retrieval-service.js';
import { createKnowledgeContextService } from '../apps/api/dist/knowledge/knowledge-context-service.js';

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
  application_name: 'axoros-knowledge-context-verification',
});

try {
  const repository = createKnowledgeRepository(pool);
  const retrieval = createKnowledgeRetrievalService(repository);
  const contextService = createKnowledgeContextService(retrieval);

  const context = await contextService.assemble({
    query: 'website development',
    agent: 'production_agent',
    task: 'website_development',
    maximumSecurityClassification: 'internal',
    limit: 8,
    maxCharacters: 6000,
  });

  if (context.includedItems < 1) throw new Error('Context package contains no Atlas items.');
  if (!context.context.includes('[ATLAS-01]')) throw new Error('Context package is missing stable Atlas references.');
  if (context.characterCount > 6000) throw new Error(`Context package exceeded character budget: ${context.characterCount}`);
  if (context.sources.length !== context.includedItems) throw new Error('Context source count does not match included items.');

  for (const source of context.sources) {
    const citation = source.citation;
    if (!['public', 'internal'].includes(citation.securityClassification)) {
      throw new Error(`Context source exceeded internal security ceiling: ${citation.securityClassification}`);
    }
    if (!citation.path || !citation.sourceVersion || !citation.documentChecksum || !citation.chunkChecksum) {
      throw new Error(`Context source ${source.reference} is missing required provenance.`);
    }
  }

  const constrained = await contextService.assemble({
    query: 'website development',
    agent: 'production_agent',
    task: 'website_development',
    maximumSecurityClassification: 'internal',
    limit: 8,
    maxCharacters: 1000,
  });

  if (constrained.characterCount > 1000) throw new Error('Constrained context exceeded its character budget.');
  if (!constrained.truncated) throw new Error('Expected constrained context to report truncation.');

  console.log(`PASS  Atlas context assembled: ${context.includedItems} item(s), ${context.characterCount} characters`);
  console.log(`PASS  Stable references verified: ${context.sources.map((source) => source.reference).join(', ')}`);
  console.log('PASS  Provenance verified for all context sources');
  console.log('PASS  Internal security ceiling enforced');
  console.log(`PASS  Context budget enforcement verified: constrained=${constrained.characterCount}, truncated=${constrained.truncated}`);
  console.log('PASS  Controlled knowledge context assembly verified');
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`FAIL  Knowledge context verification failed: ${message}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
