import assert from 'node:assert/strict';
import test from 'node:test';
import { createLeadAgentKnowledgeService } from './lead-agent-knowledge.js';
import type { KnowledgeContextRequest } from '../knowledge/knowledge-context-service.js';

test('lead agent retrieves bounded internal context for qualification', async () => {
  let captured: KnowledgeContextRequest | undefined;
  const service = createLeadAgentKnowledgeService({
    async assemble(request: KnowledgeContextRequest) {
      captured = request;
      return { query: request.query, context: 'lead context', sources: [], includedItems: 0, truncated: false, characterCount: 12 };
    },
  });
  await service.assemble('ideal client profile industry fit pricing philosophy');
  assert.equal(captured?.agent, 'lead_agent');
  assert.equal(captured?.task, 'lead_qualification');
  assert.equal(captured?.maximumSecurityClassification, 'internal');
  assert.equal(captured?.limit, 8);
});

test('lead agent cannot request oversized knowledge context', async () => {
  const service = createLeadAgentKnowledgeService({
    async assemble(request: KnowledgeContextRequest) {
      return { query: request.query, context: '', sources: [], includedItems: 0, truncated: false, characterCount: 0 };
    },
  });
  await assert.rejects(() => service.assemble('qualification', 12_001), /context size is invalid/);
});
