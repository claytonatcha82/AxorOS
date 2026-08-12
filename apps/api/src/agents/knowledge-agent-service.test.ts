import assert from 'node:assert/strict';
import test from 'node:test';
import { createKnowledgeAgentService } from './knowledge-agent-service.js';
import type { KnowledgeContextRequest } from '../knowledge/knowledge-context-service.js';

test('knowledge agent delegates retrieval to the existing bounded Atlas context service', async () => {
  let captured: KnowledgeContextRequest | undefined;
  const contextService = {
    async assemble(request: KnowledgeContextRequest) {
      captured = request;
      return { query: request.query, context: 'Atlas context', sources: [], includedItems: 0, truncated: false, characterCount: 13 };
    },
  };

  const service = createKnowledgeAgentService(contextService);
  const result = await service.retrieveContext({
    requestingAgent: 'Production Agent', task: 'website production', query: 'Build a five-page engineering website',
    requiredContext: ['development standards', 'design standards', 'SEO standards', 'accessibility'],
    maximumSecurityClassification: 'internal', limit: 8, maxCharacters: 10_000,
  });

  assert.equal(captured?.agent, 'Production Agent');
  assert.equal(captured?.task, 'website production');
  assert.match(captured?.query ?? '', /development standards/);
  assert.equal(captured?.limit, 8);
  assert.equal(captured?.maxCharacters, 10_000);
  assert.equal(result.context, 'Atlas context');
});

test('knowledge agent rejects retrieval without declared knowledge domains', async () => {
  const service = createKnowledgeAgentService({
    async assemble(request: KnowledgeContextRequest) {
      return { query: request.query, context: '', sources: [], includedItems: 0, truncated: false, characterCount: 0 };
    },
  });

  await assert.rejects(() => service.retrieveContext({
    requestingAgent: 'Sales Agent', task: 'sales conversion', query: 'Prepare proposal', requiredContext: [],
    maximumSecurityClassification: 'internal',
  }), /requiredContext/);
});
