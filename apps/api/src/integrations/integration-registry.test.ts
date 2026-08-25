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

test('scoped live rule authorises only the named integration operation', async () => {
  const registry = new IntegrationRegistry({
    defaultMode: 'sandbox',
    allowLive: false,
    liveRiskCeiling: 'low',
    scopedLiveRules: [{ integrationId: 'email.primary', operation: 'send_message', riskCeiling: 'medium' }],
  });
  registry.register(integration());

  const response = await registry.execute(request({ mode: 'live', risk: 'medium', idempotencyKey: 'live:exec-1:send' }));
  assert.equal(response.status, 'succeeded');

  await assert.rejects(
    () => registry.execute(request({ integrationId: 'email.other', mode: 'live', risk: 'medium', idempotencyKey: 'live:exec-1:other' })),
    /live integration execution is disabled by policy/,
  );
  await assert.rejects(
    () => registry.execute(request({ operation: 'delete_mailbox', mode: 'live', risk: 'medium', idempotencyKey: 'live:exec-1:delete' })),
    /live integration execution is disabled by policy/,
  );
});

test('scoped live rule enforces its own risk ceiling', async () => {
  const registry = new IntegrationRegistry({
    defaultMode: 'sandbox',
    allowLive: false,
    liveRiskCeiling: 'low',
    scopedLiveRules: [{ integrationId: 'email.primary', operation: 'send_message', riskCeiling: 'medium' }],
  });
  registry.register(integration());

  await assert.rejects(
    () => registry.execute(request({ mode: 'live', risk: 'high', idempotencyKey: 'live:exec-1:high' })),
    /exceeds policy ceiling medium/,
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

test('live execution gate is enforced after scoped policy and before provider execution', async () => {
  let providerCalls = 0;
  const provider = integration();
  provider.execute = async (input) => {
    providerCalls += 1;
    return {
      integrationId: input.integrationId,
      operation: input.operation,
      provider: 'test-provider',
      mode: input.mode,
      status: 'succeeded',
      output: { accepted: true },
      evidenceReferences: [],
      retryable: false,
    };
  };
  const registry = new IntegrationRegistry({
    defaultMode: 'sandbox',
    allowLive: false,
    liveRiskCeiling: 'low',
    scopedLiveRules: [{ integrationId: 'email.primary', operation: 'send_message', riskCeiling: 'medium' }],
  });
  registry.register(provider);
  registry.setLiveExecutionGate(async () => {
    throw new Error('pilot disabled');
  });

  await assert.rejects(
    () => registry.execute(request({ mode: 'live', risk: 'medium', idempotencyKey: 'live:exec-1:gated' })),
    /pilot disabled/,
  );
  assert.equal(providerCalls, 0);
});

test('sandbox execution does not consult live execution gate', async () => {
  let gateCalls = 0;
  const registry = new IntegrationRegistry();
  registry.register(integration());
  registry.setLiveExecutionGate(async () => {
    gateCalls += 1;
    throw new Error('must not run for sandbox');
  });

  const response = await registry.execute(request({ mode: 'sandbox' }));
  assert.equal(response.status, 'succeeded');
  assert.equal(gateCalls, 0);
});
