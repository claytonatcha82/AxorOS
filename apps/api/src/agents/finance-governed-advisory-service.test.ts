import assert from 'node:assert/strict';
import test from 'node:test';
import { IntegrationRegistry } from '../integrations/integration-registry.js';
import type { ModelGenerationInput } from '../integrations/model-integration.js';
import { createFinanceGovernedAdvisoryService } from './finance-governed-advisory-service.js';

function decision(overrides = {}) {
  return {
    commercialRecordReference: 'commercial:finance-advisory-service:1',
    gate: 'PRODUCTION_START',
    state: 'READY_TO_BIND_REQUIREMENT',
    reason: 'Verified provider payment evidence supports governed commercial payment binding, but the requirement is not yet satisfied.',
    requirementReference: 'deposit:commercial:finance-advisory-service:1',
    paymentEvidenceReference: 'payment-provider:paystack:event:1',
    paymentStatus: 'CONFIRMED',
    authorityState: 'AUTHORIZED',
    advisoryModelAllowed: true,
    ...overrides,
  } as const;
}

test('Finance governed advisory sends only deterministic assessment context to Gemini and returns decision unchanged', async () => {
  const registry = new IntegrationRegistry();
  let capturedInput: ModelGenerationInput | undefined;
  registry.register({
    integrationId: 'model.gemini',
    kind: 'model',
    provider: 'gemini-test',
    supportedModes: ['draft'],
    supportedOperations: ['generate_text'],
    async execute(request) {
      capturedInput = request.input as ModelGenerationInput;
      return {
        integrationId: 'model.gemini',
        operation: request.operation,
        provider: 'gemini-test',
        mode: request.mode,
        status: 'drafted',
        output: { text: 'Advisory only: bind the verified payment through the governed workflow.', model: 'gemini-test', finishReason: 'stop' },
        evidenceReferences: ['model:gemini:test:1'],
        retryable: false,
      };
    },
  });

  const service = createFinanceGovernedAdvisoryService({ integrations: registry });
  const authoritativeDecision = decision();
  const result = await service.advise({ executionId: 'exec:finance:1', correlationId: 'corr:finance:1', decision: authoritativeDecision });

  assert.equal(result.decision, authoritativeDecision);
  assert.equal(result.advisoryText.includes('Advisory only'), true);
  assert.ok(capturedInput);
  assert.ok(capturedInput.context);
  assert.ok(capturedInput.systemInstruction);
  assert.equal(capturedInput.context.includes('READY_TO_BIND_REQUIREMENT'), true);
  assert.equal(capturedInput.context.includes('AUTHORITATIVE DETERMINISTIC FINANCE ASSESSMENT'), true);
  assert.equal(capturedInput.systemInstruction.includes('authoritative and immutable'), true);
});

test('Finance governed advisory refuses model use when deterministic decision disallows it', async () => {
  const registry = new IntegrationRegistry();
  let calls = 0;
  registry.register({
    integrationId: 'model.gemini',
    kind: 'model',
    provider: 'gemini-test',
    supportedModes: ['draft'],
    supportedOperations: ['generate_text'],
    async execute(request) {
      calls += 1;
      return {
        integrationId: 'model.gemini', operation: request.operation, provider: 'gemini-test', mode: request.mode,
        status: 'drafted', output: { text: 'unused', model: 'gemini-test', finishReason: 'stop' }, evidenceReferences: [], retryable: false,
      };
    },
  });
  const service = createFinanceGovernedAdvisoryService({ integrations: registry });
  await assert.rejects(
    () => service.advise({ executionId: 'exec:finance:blocked', correlationId: 'corr:finance:blocked', decision: decision({ advisoryModelAllowed: false }) }),
    /does not permit advisory model use/,
  );
  assert.equal(calls, 0);
});
