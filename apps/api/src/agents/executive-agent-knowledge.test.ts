import assert from 'node:assert/strict';
import test from 'node:test';
import type { KnowledgeContextRequest, KnowledgeContextService } from '../knowledge/knowledge-context-service.js';
import { createExecutiveAgentKnowledgeService } from './executive-agent-knowledge.js';

test('prepares executive strategy context with fixed identity and policy', async () => {
  let capturedRequest: KnowledgeContextRequest | undefined;
  const contextService: Pick<KnowledgeContextService, 'assemble'> = {
    async assemble(request) {
      capturedRequest = request;
      return {
        query: request.query,
        context: '[ATLAS-01] Agency Playbook\nUse approved strategic guidance.',
        sources: [],
        includedItems: 1,
        truncated: false,
        characterCount: 64,
      };
    },
  };

  const service = createExecutiveAgentKnowledgeService(contextService);
  const result = await service.prepare({ objective: 'Prioritise the agency for today', maxCharacters: 8_000 });

  assert.equal(result.agent, 'executive_agent');
  assert.equal(result.task, 'executive_strategy');
  assert.ok(capturedRequest);
  assert.equal(capturedRequest.agent, 'executive_agent');
  assert.equal(capturedRequest.task, 'executive_strategy');
  assert.equal(capturedRequest.maximumSecurityClassification, 'internal');
  assert.equal(capturedRequest.limit, 8);
  assert.equal(capturedRequest.maxCharacters, 8_000);
});

test('executive knowledge request rejects blank objective and oversized context', async () => {
  const contextService: Pick<KnowledgeContextService, 'assemble'> = {
    async assemble(request) {
      return { query: request.query, context: '', sources: [], includedItems: 0, truncated: false, characterCount: 0 };
    },
  };
  const service = createExecutiveAgentKnowledgeService(contextService);
  await assert.rejects(() => service.prepare({ objective: '   ' }), /objective is required/);
  await assert.rejects(() => service.prepare({ objective: 'Review strategy', maxCharacters: 20_000 }), /between 1000 and 12000/);
});
