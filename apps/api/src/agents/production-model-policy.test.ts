import assert from 'node:assert/strict';
import test from 'node:test';
import { createProductionModelPolicy, DEFAULT_PRODUCTION_MODEL_POLICY } from './production-model-policy.js';

test('Production model policy preserves Gemini as safe default for existing runtimes', () => {
  assert.deepEqual(createProductionModelPolicy(), DEFAULT_PRODUCTION_MODEL_POLICY);
});

test('Production model policy can route both Production capabilities to Anthropic', () => {
  assert.deepEqual(createProductionModelPolicy('model.anthropic'), {
    projectPlanningIntegrationId: 'model.anthropic',
    technicalImplementationIntegrationId: 'model.anthropic',
  });
});
