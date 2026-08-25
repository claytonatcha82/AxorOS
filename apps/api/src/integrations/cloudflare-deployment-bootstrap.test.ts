import assert from 'node:assert/strict';
import test from 'node:test';
import type { ApiConfig } from '../config.js';
import { createConfiguredIntegrationRegistry } from './integration-bootstrap.js';

function baseConfig(overrides: Partial<ApiConfig> = {}): ApiConfig {
  return { environment: 'test', host: '127.0.0.1', port: 3001, controlCenterUrl: 'http://localhost:5173', ...overrides };
}

test('configured registry omits Cloudflare when deployment is not explicitly activated', () => {
  const { registry, registeredIntegrationIds } = createConfiguredIntegrationRegistry(baseConfig({
    cloudflareAccountId: 'account-123',
    cloudflareApiToken: 'token-123',
  }));

  assert.equal(registry.get('deployment.cloudflare'), undefined);
  assert.equal(registeredIntegrationIds.includes('deployment.cloudflare'), false);
});

test('configured registry registers Cloudflare deployment only when explicitly activated', () => {
  const { registry, registeredIntegrationIds } = createConfiguredIntegrationRegistry(baseConfig({
    cloudflareAccountId: 'account-123',
    cloudflareApiToken: 'token-123',
    deploymentIntegrationId: 'deployment.cloudflare',
  }));

  const cloudflare = registry.require('deployment.cloudflare');
  assert.equal(cloudflare.provider, 'cloudflare');
  assert.deepEqual(cloudflare.supportedModes, ['sandbox', 'live']);
  assert.deepEqual(cloudflare.supportedOperations, ['get_project', 'get_deployment_status']);
  assert.equal(registeredIntegrationIds.includes('deployment.cloudflare'), true);
});
