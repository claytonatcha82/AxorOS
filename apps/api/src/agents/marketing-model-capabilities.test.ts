import assert from 'node:assert/strict';
import test from 'node:test';
import { AgentRuntimeHandlerRegistry } from './agent-runtime-handlers.js';
import { MARKETING_DRAFT_COPY_CAPABILITY, registerMarketingModelCapabilities } from './marketing-model-capabilities.js';
import { IntegrationRegistry } from '../integrations/integration-registry.js';
import type { ExternalIntegration } from '../integrations/integration-contract.js';
import type { ModelGenerationInput, ModelGenerationOutput } from '../integrations/model-integration.js';

function task() {
  return {
    taskId: 'task-marketing-gemini-1',
    executionId: 'execution-marketing-gemini-1',
    originAgent: 'operations_agent' as const,
    destinationAgent: 'marketing_agent' as const,
    objective: 'Draft approved marketing copy',
    priority: 'normal' as const,
    context: 'Synthetic test only',
    knowledgeReferences: ['atlas://marketing/test'],
    inputs: {
      brief: 'Write a short headline for a fictional web design service.',
      context: 'Synthetic company: Example Studio. No real client data.',
    },
    expectedOutput: 'Draft headline',
    dependencies: [],
    risks: [],
    confidence: 1,
    approvalRequired: false,
    status: 'in_progress' as const,
    nextAction: 'execute_destination_capability',
    attempt: 1,
    maxAttempts: 3,
    correlationId: 'correlation-marketing-gemini-1',
    createdAt: '2026-08-15T10:00:00.000Z',
    updatedAt: '2026-08-15T10:00:00.000Z',
  };
}

test('Marketing Agent draft copy capability uses Gemini in governed draft mode', async () => {
  let captured: unknown;
  const gemini: ExternalIntegration<ModelGenerationInput, ModelGenerationOutput> = {
    integrationId: 'model.gemini',
    kind: 'model',
    provider: 'google-gemini',
    supportedModes: ['draft'],
    supportedOperations: ['generate_text'],
    async execute(request) {
      captured = request;
      return {
        integrationId: 'model.gemini',
        operation: request.operation,
        provider: 'google-gemini',
        mode: request.mode,
        status: 'drafted',
        output: {
          text: 'Build a sharper digital presence.',
          model: 'gemini-3.5-flash-lite',
          finishReason: 'stop',
        },
        evidenceReferences: ['gemini:test:marketing'],
        retryable: false,
      };
    },
  };

  const integrations = new IntegrationRegistry();
  integrations.register(gemini);
  const handlers = new AgentRuntimeHandlerRegistry();
  registerMarketingModelCapabilities(handlers, integrations);

  const handler = handlers.require('marketing_agent', MARKETING_DRAFT_COPY_CAPABILITY);
  const result = await handler.execute(task());

  assert.equal(result.status, 'completed');
  assert.equal(result.output.provider, 'google-gemini');
  assert.equal(result.output.mode, 'draft');
  assert.equal(result.output.integrationStatus, 'drafted');
  assert.deepEqual(result.knowledgeReferences, ['atlas://marketing/test']);

  const request = captured as { requestedBy: string; mode: string; risk: string; input: ModelGenerationInput };
  assert.equal(request.requestedBy, 'marketing_agent');
  assert.equal(request.mode, 'draft');
  assert.equal(request.risk, 'low');
  assert.equal(request.input.prompt, 'Write a short headline for a fictional web design service.');
  assert.equal(request.input.context, 'Synthetic company: Example Studio. No real client data.');
  assert.match(request.input.systemInstruction ?? '', /Do not publish, send, post/);
  assert.equal(request.input.maxOutputTokens, 512);
  assert.equal(request.input.temperature, 0.4);
});
