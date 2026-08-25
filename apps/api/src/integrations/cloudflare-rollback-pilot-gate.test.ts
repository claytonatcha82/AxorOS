import assert from 'node:assert/strict';
import test from 'node:test';
import type { ApiConfig } from '../config.js';
import { createConfiguredIntegrationRegistry } from './integration-bootstrap.js';

function cloudflareConfig(): ApiConfig {
  return {
    environment: 'test',
    host: '127.0.0.1',
    port: 3001,
    controlCenterUrl: 'http://localhost:5173',
    deploymentIntegrationId: 'deployment.cloudflare',
    cloudflareAccountId: 'acct-1',
    cloudflareApiToken: 'token-1',
  };
}

test('configured registry exposes Cloudflare rollback as critical live operation', () => {
  const { registry, registeredIntegrationIds } = createConfiguredIntegrationRegistry(cloudflareConfig());
  assert.ok(registeredIntegrationIds.includes('deployment.cloudflare'));
  assert.ok(registeredIntegrationIds.includes('deployment.cloudflare.rollback'));
  const rollback = registry.require('deployment.cloudflare.rollback');
  assert.deepEqual(rollback.supportedModes, ['live']);
  assert.deepEqual(rollback.supportedOperations, ['rollback_production']);
});

test('Cloudflare rollback is blocked by the authoritative pilot live-execution gate before provider execution', async () => {
  let gateCalls = 0;
  const { registry } = createConfiguredIntegrationRegistry(cloudflareConfig(), {
    liveExecutionGate: async () => {
      gateCalls += 1;
      throw new Error('blocked while pilot state is PILOT_DISABLED.');
    },
  });

  await assert.rejects(
    () => registry.execute({
      integrationId: 'deployment.cloudflare.rollback',
      operation: 'rollback_production',
      requestedBy: 'production_agent',
      executionId: 'exec-rollback-gate',
      correlationId: 'corr-rollback-gate',
      mode: 'live',
      risk: 'critical',
      idempotencyKey: 'rollback:pilot-disabled',
      input: { projectName: 'client-site', deploymentId: 'deploy-1' },
    }),
    /PILOT_DISABLED/,
  );
  assert.equal(gateCalls, 1);
});
