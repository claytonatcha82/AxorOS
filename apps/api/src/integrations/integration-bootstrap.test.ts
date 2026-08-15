import assert from 'node:assert/strict';
import test from 'node:test';
import type { ApiConfig } from '../config.js';
import { createConfiguredIntegrationRegistry } from './integration-bootstrap.js';

function baseConfig(overrides: Partial<ApiConfig> = {}): ApiConfig {
  return {
    environment: 'test',
    host: '127.0.0.1',
    port: 3001,
    controlCenterUrl: 'http://localhost:5173',
    ...overrides,
  };
}

test('configured registry always includes sandbox and omits optional providers without credentials', () => {
  const { registry, registeredIntegrationIds } = createConfiguredIntegrationRegistry(baseConfig());

  assert.deepEqual(registeredIntegrationIds, ['model.sandbox']);
  assert.equal(registry.get('model.sandbox')?.provider, 'axoros-sandbox');
  assert.equal(registry.get('model.gemini'), undefined);
  assert.equal(registry.get('email.gmail'), undefined);
});

test('configured registry registers Gemini only when a key is configured', () => {
  const { registry, registeredIntegrationIds } = createConfiguredIntegrationRegistry(baseConfig({
    geminiApiKey: 'test-secret',
    geminiModel: 'gemini-test-model',
  }));

  assert.deepEqual(registeredIntegrationIds, ['model.sandbox', 'model.gemini']);
  assert.equal(registry.require('model.gemini').provider, 'google-gemini');
  assert.deepEqual(registry.require('model.gemini').supportedModes, ['draft']);
});

test('configured registry registers Gmail as draft-only when complete credentials are configured', () => {
  const { registry, registeredIntegrationIds } = createConfiguredIntegrationRegistry(baseConfig({
    gmailClientId: 'client-id',
    gmailClientSecret: 'client-secret',
    gmailRefreshToken: 'refresh-token',
    gmailIdentityAddresses: { sales: 'sales@example.test' },
  }));

  assert.deepEqual(registeredIntegrationIds, ['model.sandbox', 'email.gmail']);
  const gmail = registry.require('email.gmail');
  assert.equal(gmail.provider, 'google-gmail');
  assert.deepEqual(gmail.supportedModes, ['draft']);
  assert.deepEqual(gmail.supportedOperations, ['create_draft']);
});
