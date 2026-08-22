import assert from 'node:assert/strict';
import test from 'node:test';
import { loadConfig } from './config.js';

test('loadConfig reads Anthropic credentials, model, and Production provider selection', () => {
  const config = loadConfig({
    ANTHROPIC_API_KEY: '  anthropic-secret  ',
    AXOROS_ANTHROPIC_MODEL: '  claude-sonnet-5  ',
    AXOROS_PRODUCTION_MODEL_INTEGRATION: 'model.anthropic',
  });

  assert.equal(config.anthropicApiKey, 'anthropic-secret');
  assert.equal(config.anthropicModel, 'claude-sonnet-5');
  assert.equal(config.productionModelIntegrationId, 'model.anthropic');
});

test('loadConfig does not activate Anthropic Production just because a credential exists', () => {
  const config = loadConfig({ ANTHROPIC_API_KEY: 'anthropic-secret' });
  assert.equal(config.anthropicApiKey, 'anthropic-secret');
  assert.equal(config.productionModelIntegrationId, undefined);
});

test('loadConfig fails closed when Anthropic is selected for Production without a credential', () => {
  assert.throws(
    () => loadConfig({ AXOROS_PRODUCTION_MODEL_INTEGRATION: 'model.anthropic' }),
    /requires ANTHROPIC_API_KEY/,
  );
});

test('loadConfig rejects unknown Production model integrations', () => {
  assert.throws(
    () => loadConfig({ AXOROS_PRODUCTION_MODEL_INTEGRATION: 'model.unknown' }),
    /must be model.gemini, model.openai, or model.anthropic/,
  );
});
