import assert from 'node:assert/strict';
import test from 'node:test';
import { createMarketingAgentKnowledgeService, MARKETING_AGENT_KNOWLEDGE_POLICY } from './marketing-agent-knowledge.js';
import type { KnowledgeContextRequest } from '../knowledge/knowledge-context-service.js';

test('marketing retrieves bounded internal Atlas context', async () => {
  let captured: KnowledgeContextRequest | undefined;
  const service = createMarketingAgentKnowledgeService({ async assemble(request: KnowledgeContextRequest) { captured = request; return { query: request.query, context: '', sources: [], includedItems: 0, truncated: false, characterCount: 0 }; } });
  await service.assemble('agency positioning services brand voice ideal client projects industry knowledge');
  assert.equal(captured?.agent, 'marketing_agent');
  assert.equal(captured?.task, 'brand_growth_and_inbound_demand');
  assert.equal(captured?.maximumSecurityClassification, 'internal');
  assert.equal(captured?.limit, 10);
});

test('marketing cannot request oversized Atlas context', async () => {
  const service = createMarketingAgentKnowledgeService({ async assemble(request: KnowledgeContextRequest) { return { query: request.query, context: '', sources: [], includedItems: 0, truncated: false, characterCount: 0 }; } });
  await assert.rejects(() => service.assemble('marketing strategy', MARKETING_AGENT_KNOWLEDGE_POLICY.absoluteMaxCharacters + 1), /absolute maximum/);
});
