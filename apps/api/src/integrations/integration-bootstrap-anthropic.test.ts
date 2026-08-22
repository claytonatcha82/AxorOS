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

test('configured registry registers Anthropic only when a key is configured', () => {
  const { registry, registeredIntegrationIds } = createConfiguredIntegrationRegistry(baseConfig({
    anthropicApiKey: 'test-anthropic-secret',
    anthropicModel: 'claude-sonnet-5',
  }));

  assert.deepEqual(registeredIntegrationIds, ['model.sandbox', 'payment.sandbox', 'model.anthropic']);
  const anthropic = registry.require('model.anthropic');
  assert.equal(anthropic.provider, 'anthropic');
  assert.deepEqual(anthropic.supportedModes, ['draft']);
  assert.deepEqual(anthropic.supportedOperations, ['generate_text']);
});

test('configured registry allows Gemini, OpenAI, and Anthropic to coexist', () => {
  const { registry, registeredIntegrationIds } = createConfiguredIntegrationRegistry(baseConfig({
    geminiApiKey: 'test-gemini-secret',
    geminiModel: 'gemini-test-model',
    openaiApiKey: 'test-openai-secret',
    openaiModel: 'gpt-test-model',
    anthropicApiKey: 'test-anthropic-secret',
    anthropicModel: 'claude-sonnet-5',
  }));

  assert.deepEqual(registeredIntegrationIds, [
    'model.sandbox',
    'payment.sandbox',
    'model.gemini',
    'model.openai',
    'model.anthropic',
  ]);
  assert.equal(registry.require('model.gemini').provider, 'google-gemini');
  assert.equal(registry.require('model.openai').provider, 'openai');
  assert.equal(registry.require('model.anthropic').provider, 'anthropic');
});
