import assert from 'node:assert/strict';
import test from 'node:test';
import type { KnowledgeContextRequest, KnowledgeContextService } from '../knowledge/knowledge-context-service.js';
import { createSalesAgentKnowledgeService } from './sales-agent-knowledge.js';

test('prepares sales context with fixed identity task and security ceiling', async () => {
  let capturedRequest: KnowledgeContextRequest | undefined;
  const contextService: Pick<KnowledgeContextService, 'assemble'> = {
    async assemble(request) {
      capturedRequest = request;
      return { query: request.query, context: '[ATLAS-01] Sales Philosophy', sources: [], includedItems: 1, truncated: false, characterCount: 27 };
    },
  };

  const service = createSalesAgentKnowledgeService(contextService);
  const result = await service.prepare({ objective: 'Prepare pricing-safe website proposal', maxCharacters: 9000 });

  assert.equal(result.agent, 'sales_agent');
  assert.equal(result.task, 'sales_conversion');
  assert.ok(capturedRequest);
  assert.equal(capturedRequest.agent, 'sales_agent');
  assert.equal(capturedRequest.task, 'sales_conversion');
  assert.equal(capturedRequest.maximumSecurityClassification, 'internal');
  assert.equal(capturedRequest.limit, 8);
  assert.equal(capturedRequest.maxCharacters, 9000);
});

test('rejects blank objectives and oversized sales context', async () => {
  const contextService: Pick<KnowledgeContextService, 'assemble'> = {
    async assemble(request) {
      return { query: request.query, context: '', sources: [], includedItems: 0, truncated: false, characterCount: 0 };
    },
  };
  const service = createSalesAgentKnowledgeService(contextService);

  await assert.rejects(() => service.prepare({ objective: '   ' }), /objective is required/);
  await assert.rejects(() => service.prepare({ objective: 'proposal', maxCharacters: 20000 }), /maxCharacters must be an integer between 1000 and 12000/);
});
