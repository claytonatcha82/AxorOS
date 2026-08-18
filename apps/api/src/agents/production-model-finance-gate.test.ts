import assert from 'node:assert/strict';
import test from 'node:test';
import { AgentRuntimeHandlerRegistry } from './agent-runtime-handlers.js';
import type { AgentRuntimeTask } from './agent-runtime-contract.js';
import { registerProductionModelCapabilities, PRODUCTION_TECHNICAL_ASSISTANCE_CAPABILITY } from './production-model-capabilities.js';
import type { PersistedFinanceClearanceDecision } from '../data/finance-clearance-postgres-store.js';
import type { PersistedFinancePaymentCurrentState } from '../data/finance-payment-current-state-postgres-store.js';
import { IntegrationRegistry } from '../integrations/integration-registry.js';
import type { ExternalIntegration, IntegrationRequest, IntegrationResponse } from '../integrations/integration-contract.js';
import type { ModelGenerationInput, ModelGenerationOutput } from '../integrations/model-integration.js';

class CountingModelIntegration implements ExternalIntegration<ModelGenerationInput, ModelGenerationOutput> {
  readonly integrationId = 'model.gemini';
  readonly kind = 'model' as const;
  readonly provider = 'counting-model';
  readonly supportedModes = ['draft'] as const;
  readonly supportedOperations = ['generate_text'] as const;
  calls = 0;
  async execute(request: IntegrationRequest<ModelGenerationInput>): Promise<IntegrationResponse<ModelGenerationOutput>> {
    this.calls += 1;
    return { integrationId: this.integrationId, operation: request.operation, provider: this.provider, mode: request.mode, status: 'drafted', output: { text: 'technical draft', model: 'test-model', finishReason: 'stop' }, evidenceReferences: ['model:test:1'], retryable: false };
  }
}

const cleared: PersistedFinanceClearanceDecision = {
  clearanceId: 'clearance:test:1', commercialRecordReference: 'commercial:test:1', providerPaymentReference: 'pay:test:1',
  state: 'FINANCE_CLEARED', reason: 'Provider evidence matched.', evidenceReferences: ['payment-provider:event:1'],
  amountMinor: 10000, currency: 'ZAR', verifiedAt: '2026-08-18T08:50:00.000Z',
};

const authorizedPaymentState: PersistedFinancePaymentCurrentState = {
  provider: 'test-provider',
  providerPaymentReference: cleared.providerPaymentReference,
  commercialRecordReference: cleared.commercialRecordReference,
  paymentStatus: 'CONFIRMED',
  authorityState: 'AUTHORIZED',
  reason: 'Provider payment remains authorized.',
  latestEventType: 'payment_paid',
  latestProviderEventReference: 'event:test:paid:1',
  latestEvidenceReference: cleared.evidenceReferences[0]!,
  latestOccurredAt: cleared.verifiedAt,
  amountMinor: cleared.amountMinor,
  currency: cleared.currency,
};

function task(context: AgentRuntimeTask['context'] = {}): AgentRuntimeTask {
  const now = '2026-08-18T08:50:00.000Z';
  return { taskId: 'task-production-model-gate', executionId: 'exec-production-model-gate', originAgent: 'operations_agent', destinationAgent: 'production_agent', objective: 'Draft implementation', priority: 'normal', context, knowledgeReferences: [], inputs: { implementationBrief: 'Create the governed implementation draft.' }, expectedOutput: 'Technical draft', dependencies: [], risks: [], confidence: 1, approvalRequired: false, status: 'ready', nextAction: 'execute_destination_capability', attempt: 1, maxAttempts: 1, correlationId: 'corr-production-model-gate', createdAt: now, updatedAt: now };
}

function setup(decision: PersistedFinanceClearanceDecision | null, paymentState: PersistedFinancePaymentCurrentState | null = authorizedPaymentState) {
  const model = new CountingModelIntegration();
  const integrations = new IntegrationRegistry();
  integrations.register(model);
  const handlers = new AgentRuntimeHandlerRegistry();
  registerProductionModelCapabilities(
    handlers,
    integrations,
    { async get() { return decision; } },
    { async get() { return paymentState; } },
  );
  return { model, handler: handlers.require('production_agent', PRODUCTION_TECHNICAL_ASSISTANCE_CAPABILITY) };
}

test('Production model provider is never called without trusted clearance reference', async () => {
  const { model, handler } = setup(cleared);
  await assert.rejects(() => handler.execute(task()), /financeClearanceId/);
  assert.equal(model.calls, 0);
});

test('caller-authored legacy FINANCE_CLEARED context cannot authorize Production', async () => {
  const { model, handler } = setup(cleared);
  await assert.rejects(() => handler.execute(task({ financeGate: { state: 'FINANCE_CLEARED', evidenceReferences: ['fake'] } })), /financeClearanceId/);
  assert.equal(model.calls, 0);
});

test('Production model provider is never called when persisted clearance is missing', async () => {
  const { model, handler } = setup(null);
  await assert.rejects(() => handler.execute(task({ financeClearanceId: 'clearance:missing', commercialRecordReference: 'commercial:test:1' })), /not found/);
  assert.equal(model.calls, 0);
});

test('Production model provider is never called when authoritative current payment state is missing', async () => {
  const { model, handler } = setup(cleared, null);
  await assert.rejects(() => handler.execute(task({ financeClearanceId: cleared.clearanceId, commercialRecordReference: cleared.commercialRecordReference })), /current payment state/);
  assert.equal(model.calls, 0);
});

test('Production model capability executes after trusted persisted clearance and current payment authorization', async () => {
  const { model, handler } = setup(cleared);
  const result = await handler.execute(task({ financeClearanceId: cleared.clearanceId, commercialRecordReference: cleared.commercialRecordReference }));
  assert.equal(model.calls, 1);
  assert.equal(result.status, 'completed');
  assert.equal(result.output.text, 'technical draft');
});
