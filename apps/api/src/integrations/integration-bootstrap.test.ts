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

test('configured registry always includes sandbox and omits Gemini without a key', () => {
  const { registry, registeredIntegrationIds } = createConfiguredIntegrationRegistry(baseConfig());

  assert.deepEqual(registeredIntegrationIds, ['model.sandbox']);
  assert.equal(registry.get('model.sandbox')?.provider, 'axoros-sandbox');
  assert.equal(registry.get('model.gemini'), undefined);
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
