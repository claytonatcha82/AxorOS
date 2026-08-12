import assert from 'node:assert/strict';
import test from 'node:test';
import { createOperationsAgentKnowledgeService, OPERATIONS_AGENT_KNOWLEDGE_POLICY } from './operations-agent-knowledge.js';
import type { KnowledgeContextRequest } from '../knowledge/knowledge-context-service.js';

test('operations knowledge retrieval is bounded to internal orchestration context', async () => {
  let captured: KnowledgeContextRequest | undefined;
  const service = createOperationsAgentKnowledgeService({
    async assemble(request: KnowledgeContextRequest) {
      captured = request;
      return { query: request.query, context: 'workflow context', sources: [], includedItems: 0, truncated: false, characterCount: 16 };
    },
  });
  await service.assemble('website production workflow dependencies');
  assert.equal(captured?.agent, 'operations_agent');
  assert.equal(captured?.task, 'workflow_orchestration');
  assert.equal(captured?.maximumSecurityClassification, 'internal');
  assert.equal(captured?.limit, 8);
});

test('operations cannot request an oversized Atlas context package', async () => {
  const service = createOperationsAgentKnowledgeService({
    async assemble(request: KnowledgeContextRequest) {
      return { query: request.query, context: '', sources: [], includedItems: 0, truncated: false, characterCount: 0 };
    },
  });
  await assert.rejects(() => service.assemble('workflow', OPERATIONS_AGENT_KNOWLEDGE_POLICY.absoluteMaxCharacters + 1), /absolute maximum/);
});
