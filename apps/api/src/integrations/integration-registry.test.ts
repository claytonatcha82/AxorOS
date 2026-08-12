import assert from 'node:assert/strict';
import test from 'node:test';
import type { ExternalIntegration, IntegrationRequest } from './integration-contract.js';
import { IntegrationRegistry } from './integration-registry.js';

function request(overrides: Partial<IntegrationRequest> = {}): IntegrationRequest {
  return {
    integrationId: 'email.primary',
    operation: 'send_message',
    requestedBy: 'sales_agent',
    executionId: 'exec-1',
    correlationId: 'corr-1',
    mode: 'sandbox',
    risk: 'medium',
    input: { to: 'prospect@example.com' },
    ...overrides,
  };
}

function integration(): ExternalIntegration {
  return {
    integrationId: 'email.primary',
    kind: 'email',
    provider: 'test-provider',
    supportedModes: ['sandbox', 'draft', 'live'],
    supportedOperations: ['send_message'],
    async execute(input) {
      return {
        integrationId: input.integrationId,
        operation: input.operation,
        provider: 'test-provider',
        mode: input.mode,
        status: input.mode === 'draft' ? 'drafted' : 'succeeded',
        output: { accepted: true },
        evidenceReferences: [],
        retryable: false,
      };
    },
  };
}

test('integration registry executes registered sandbox integration', async () => {
  const registry = new IntegrationRegistry();
  registry.register(integration());
  const response = await registry.execute(request());
  assert.equal(response.status, 'succeeded');
  assert.equal(response.provider, 'test-provider');
});

test('integration registry blocks live execution by safe default', async () => {
  const registry = new IntegrationRegistry();
  registry.register(integration());
  await assert.rejects(
    () => registry.execute(request({ mode: 'live', idempotencyKey: 'live:exec-1:send' })),
    /live integration execution is disabled by policy/,
  );
});

test('explicit live policy still enforces risk ceiling', async () => {
  const registry = new IntegrationRegistry({ defaultMode: 'sandbox', allowLive: true, liveRiskCeiling: 'medium' });
  registry.register(integration());

  const medium = await registry.execute(request({ mode: 'live', risk: 'medium', idempotencyKey: 'live:exec-1:send' }));
  assert.equal(medium.status, 'succeeded');

  await assert.rejects(
    () => registry.execute(request({ mode: 'live', risk: 'high', idempotencyKey: 'live:exec-1:send-high' })),
    /exceeds policy ceiling/,
  );
});

test('live medium-risk request requires idempotency key', async () => {
  const registry = new IntegrationRegistry({ defaultMode: 'sandbox', allowLive: true, liveRiskCeiling: 'medium' });
  registry.register(integration());
  await assert.rejects(() => registry.execute(request({ mode: 'live', risk: 'medium' })), /require an idempotencyKey/);
});

test('registry refuses unsupported operations before provider execution', async () => {
  const registry = new IntegrationRegistry();
  registry.register(integration());
  await assert.rejects(() => registry.execute(request({ operation: 'delete_mailbox' })), /does not support operation/);
});
