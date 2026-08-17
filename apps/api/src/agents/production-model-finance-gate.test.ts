import assert from 'node:assert/strict';
import test from 'node:test';
import { AgentRuntimeHandlerRegistry } from './agent-runtime-handlers.js';
import type { AgentRuntimeTask } from './agent-runtime-contract.js';
import { registerProductionModelCapabilities, PRODUCTION_TECHNICAL_ASSISTANCE_CAPABILITY } from './production-model-capabilities.js';
import { IntegrationRegistry } from '../integrations/integration-registry.js';
import type { ExternalIntegration, IntegrationRequest, IntegrationResponse } from '../integrations/integration-contract.js';
import type { ModelGenerationInput, ModelGenerationOutput } from '../integrations/model-integration.js';

class CountingModelIntegration implements ExternalIntegration<ModelGenerationInput, ModelGenerationOutput> {
  readonly integrationId = 'model.gemini';
  readonly kind = 'model' as const;
  readonly provider = 'counting-model';
  readonly supportedModes = ['draft'] as const;
  readonly supportedOperations = ['generate_text'] as const;
  calls = 0;
  async execute(request: IntegrationRequest<ModelGenerationInput>): Promise<IntegrationResponse<ModelGenerationOutput>> {
    this.calls += 1;
    return { integrationId: this.integrationId, operation: request.operation, provider: this.provider, mode: request.mode, status: 'drafted', output: { text: 'technical draft', model: 'test-model' }, evidenceReferences: ['model:test:1'], retryable: false };
  }
}

function task(context: AgentRuntimeTask['context'] = {}): AgentRuntimeTask {
  const now = '2026-08-17T21:17:00.000Z';
  return { taskId: 'task-production-model-gate', executionId: 'exec-production-model-gate', originAgent: 'operations_agent', destinationAgent: 'production_agent', objective: 'Draft implementation', priority: 'normal', context, knowledgeReferences: [], inputs: { implementationBrief: 'Create the governed implementation draft.' }, expectedOutput: 'Technical draft', dependencies: [], risks: [], confidence: 1, approvalRequired: false, status: 'ready', nextAction: 'execute_destination_capability', attempt: 1, maxAttempts: 1, correlationId: 'corr-production-model-gate', createdAt: now, updatedAt: now };
}

function setup() {
  const model = new CountingModelIntegration();
  const integrations = new IntegrationRegistry();
  integrations.register(model);
  const handlers = new AgentRuntimeHandlerRegistry();
  registerProductionModelCapabilities(handlers, integrations);
  return { model, handler: handlers.require('production_agent', PRODUCTION_TECHNICAL_ASSISTANCE_CAPABILITY) };
}

test('Production model provider is never called without FINANCE_CLEARED evidence', async () => {
  const { model, handler } = setup();
  await assert.rejects(() => handler.execute(task()), /FINANCE_CLEARED evidence is missing/);
  assert.equal(model.calls, 0);
});

test('Production model provider is never called with FINANCE_PENDING context', async () => {
  const { model, handler } = setup();
  await assert.rejects(() => handler.execute(task({ financeGate: { state: 'FINANCE_PENDING', evidenceReferences: ['payment:pending'] } })), /valid FINANCE_CLEARED evidence is required/);
  assert.equal(model.calls, 0);
});

test('Production model capability executes after valid FINANCE_CLEARED evidence', async () => {
  const { model, handler } = setup();
  const result = await handler.execute(task({ financeGate: { state: 'FINANCE_CLEARED', commercialRecordReference: 'commercial:test:1', evidenceReferences: ['payment-provider:event:1'] } }));
  assert.equal(model.calls, 1);
  assert.equal(result.status, 'completed');
  assert.equal(result.output.text, 'technical draft');
});
