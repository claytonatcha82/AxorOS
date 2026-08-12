import assert from 'node:assert/strict';
import test from 'node:test';
import { createSupportAgentKnowledgeService, SUPPORT_AGENT_KNOWLEDGE_POLICY } from './support-agent-knowledge.js';
import type { KnowledgeContextRequest } from '../knowledge/knowledge-context-service.js';

test('support retrieval is bounded to internal client support knowledge', async () => {
  let captured: KnowledgeContextRequest | undefined;
  const service = createSupportAgentKnowledgeService({ async assemble(request: KnowledgeContextRequest) { captured = request; return { query: request.query, context: '', sources: [], includedItems: 0, truncated: false, characterCount: 0 }; } });
  await service.assemble('maintenance SOP and escalation policy');
  assert.equal(captured?.agent, 'support_agent');
  assert.equal(captured?.task, 'client_support_and_maintenance');
  assert.equal(captured?.maximumSecurityClassification, 'internal');
  assert.equal(captured?.limit, 8);
});

test('support cannot request oversized Atlas context', async () => {
  const service = createSupportAgentKnowledgeService({ async assemble(request: KnowledgeContextRequest) { return { query: request.query, context: '', sources: [], includedItems: 0, truncated: false, characterCount: 0 }; } });
  await assert.rejects(() => service.assemble('support workflow', SUPPORT_AGENT_KNOWLEDGE_POLICY.absoluteMaxCharacters + 1), /absolute maximum/);
});
