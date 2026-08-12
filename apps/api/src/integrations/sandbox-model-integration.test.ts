import assert from 'node:assert/strict';
import test from 'node:test';
import { IntegrationRegistry } from './integration-registry.js';
import { createSandboxModelIntegration } from './sandbox-model-integration.js';

test('sandbox model integration produces deterministic non-live output', async () => {
  const registry = new IntegrationRegistry();
  registry.register(createSandboxModelIntegration());

  const response = await registry.execute({
    integrationId: 'model.sandbox',
    operation: 'generate_text',
    requestedBy: 'marketing_agent',
    executionId: 'exec-1',
    correlationId: 'corr-1',
    mode: 'sandbox',
    risk: 'low',
    input: {
      prompt: 'Draft a short headline.',
      context: 'Premium web agency',
      systemInstruction: 'Be concise.',
    },
  });

  assert.equal(response.provider, 'axoros-sandbox');
  assert.equal(response.status, 'succeeded');
  assert.match(String(response.output.text), /\[SANDBOX MODEL OUTPUT\]/);
  assert.match(String(response.output.text), /Draft a short headline\./);
});

test('sandbox model integration rejects live mode through registry policy', async () => {
  const registry = new IntegrationRegistry();
  registry.register(createSandboxModelIntegration());

  await assert.rejects(
    () => registry.execute({
      integrationId: 'model.sandbox',
      operation: 'generate_text',
      requestedBy: 'marketing_agent',
      executionId: 'exec-1',
      correlationId: 'corr-1',
      mode: 'live',
      risk: 'low',
      input: { prompt: 'This must not execute live.' },
    }),
    /live integration execution is disabled by policy/,
  );
});
