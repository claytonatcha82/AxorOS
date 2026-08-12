import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentRuntimeTask } from './agent-runtime-contract.js';
import { createModelAgentRuntimeHandler } from './model-agent-handler.js';
import { IntegrationRegistry } from '../integrations/integration-registry.js';
import { createSandboxModelIntegration } from '../integrations/sandbox-model-integration.js';

function task(inputs: Record<string, unknown>): AgentRuntimeTask {
  return {
    taskId: 'task-1',
    executionId: 'exec-1',
    originAgent: 'operations_agent',
    destinationAgent: 'marketing_agent',
    objective: 'Draft marketing copy',
    priority: 'normal',
    context: {},
    knowledgeReferences: ['knowledge-1'],
    inputs,
    expectedOutput: 'Draft copy',
    dependencies: [],
    risks: [],
    confidence: 0.9,
    approvalRequired: false,
    status: 'in_progress',
    nextAction: 'execute_destination_capability',
    attempt: 1,
    maxAttempts: 3,
    correlationId: 'corr-1',
    createdAt: '2026-08-12T19:30:00.000Z',
    updatedAt: '2026-08-12T19:30:00.000Z',
  };
}

test('model agent handler executes through governed sandbox integration', async () => {
  const registry = new IntegrationRegistry();
  registry.register(createSandboxModelIntegration());

  const handler = createModelAgentRuntimeHandler(registry, {
    agentId: 'marketing_agent',
    capabilityId: 'draft_marketing_copy',
    integrationId: 'model.sandbox',
    mode: 'sandbox',
    promptInputKey: 'brief',
    contextInputKey: 'context',
    systemInstruction: 'Write concise agency marketing copy.',
  });

  const result = await handler.execute(task({
    brief: 'Create a homepage headline.',
    context: 'Premium web agency for South African businesses.',
  }));

  assert.equal(result.status, 'completed');
  assert.equal(result.agentId, 'marketing_agent');
  assert.equal(result.output.integrationId, 'model.sandbox');
  assert.equal(result.output.mode, 'sandbox');
  assert.match(String(result.output.text), /Create a homepage headline\./);
  assert.deepEqual(result.knowledgeReferences, ['knowledge-1']);
});

test('model agent handler rejects missing prompt input before provider execution', async () => {
  const registry = new IntegrationRegistry();
  registry.register(createSandboxModelIntegration());

  const handler = createModelAgentRuntimeHandler(registry, {
    agentId: 'marketing_agent',
    capabilityId: 'draft_marketing_copy',
    integrationId: 'model.sandbox',
    promptInputKey: 'brief',
  });

  await assert.rejects(() => handler.execute(task({})), /requires string input brief/);
});
