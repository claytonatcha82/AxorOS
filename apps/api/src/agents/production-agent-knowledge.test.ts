import assert from 'node:assert/strict';
import test from 'node:test';
import { createProductionAgentKnowledgeService } from './production-agent-knowledge.js';

test('prepares production-agent website context with fixed identity and policy', async () => {
  let capturedRequest: Record<string, unknown> | undefined;
  const contextService = {
    async assemble(request: Record<string, unknown>) {
      capturedRequest = request;
      return {
        query: String(request.query),
        context: '[ATLAS-01] Website Delivery\nUse Atlas guidance.',
        sources: [],
        includedItems: 1,
        truncated: false,
        characterCount: 48,
      };
    },
  };

  const service = createProductionAgentKnowledgeService(contextService);
  const result = await service.prepare({ objective: 'Build a professional plumbing company website', maxCharacters: 8_000 });

  assert.equal(result.agent, 'production_agent');
  assert.equal(result.task, 'website_development');
  assert.equal(result.objective, 'Build a professional plumbing company website');
  assert.ok(capturedRequest);
  assert.equal(capturedRequest.agent, 'production_agent');
  assert.equal(capturedRequest.task, 'website_development');
  assert.equal(capturedRequest.maximumSecurityClassification, 'internal');
  assert.equal(capturedRequest.limit, 8);
  assert.equal(capturedRequest.maxCharacters, 8_000);
});

test('caller cannot override agent identity, task, or security policy', async () => {
  let capturedRequest: Record<string, unknown> | undefined;
  const contextService = {
    async assemble(request: Record<string, unknown>) {
      capturedRequest = request;
      return { query: String(request.query), context: '', sources: [], includedItems: 0, truncated: false, characterCount: 0 };
    },
  };

  const service = createProductionAgentKnowledgeService(contextService);
  await service.prepare({ objective: 'Prepare a website build plan' });

  assert.equal(capturedRequest?.agent, 'production_agent');
  assert.equal(capturedRequest?.task, 'website_development');
  assert.equal(capturedRequest?.maximumSecurityClassification, 'internal');
});

test('rejects blank objectives and oversized context requests', async () => {
  const contextService = {
    async assemble() {
      return { query: '', context: '', sources: [], includedItems: 0, truncated: false, characterCount: 0 };
    },
  };
  const service = createProductionAgentKnowledgeService(contextService);

  await assert.rejects(() => service.prepare({ objective: '   ' }), /objective is required/);
  await assert.rejects(
    () => service.prepare({ objective: 'Build website', maxCharacters: 20_000 }),
    /maxCharacters must be an integer between 1000 and 12000/,
  );
});
