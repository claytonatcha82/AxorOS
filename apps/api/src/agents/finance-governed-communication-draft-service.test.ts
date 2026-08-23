import assert from 'node:assert/strict';
import test from 'node:test';
import { IntegrationRegistry } from '../integrations/integration-registry.js';
import type { ExternalIntegration } from '../integrations/integration-contract.js';
import type { ModelGenerationInput, ModelGenerationOutput } from '../integrations/model-integration.js';
import { createFinanceGovernedCommunicationDraftService } from './finance-governed-communication-draft-service.js';
import type { FinanceGovernedOperationalDecision } from './finance-governed-operational-coordinator.js';

function decision(
  state: FinanceGovernedOperationalDecision['state'],
  overrides: Partial<FinanceGovernedOperationalDecision> = {},
): FinanceGovernedOperationalDecision {
  return {
    commercialRecordReference: 'commercial:finance-communication:1',
    gate: 'PRODUCTION_START',
    state,
    reason: `authoritative-${state}`,
    requirementReference: 'deposit:commercial:finance-communication:1',
    advisoryModelAllowed: true,
    ...overrides,
  };
}

function registry(calls: ModelGenerationInput[]): IntegrationRegistry {
  const integrations = new IntegrationRegistry();
  const model: ExternalIntegration<ModelGenerationInput, ModelGenerationOutput> = {
    integrationId: 'model.gemini',
    provider: 'google-gemini',
    kind: 'model',
    supportedModes: ['draft'],
    supportedOperations: ['generate_text'],
    async execute(request) {
      calls.push(request.input);
      return {
        integrationId: 'model.gemini',
        provider: 'google-gemini',
        operation: request.operation,
        mode: request.mode,
        status: 'drafted',
        retryable: false,
        output: { text: 'Governed Finance client draft.', model: 'gemini-test', finishReason: 'stop' },
        evidenceReferences: ['model:gemini:test'],
      };
    },
  };
  integrations.register(model);
  return integrations;
}

test('Finance communication drafting passes only deterministic verification-request intent to Gemini', async () => {
  const calls: ModelGenerationInput[] = [];
  const service = createFinanceGovernedCommunicationDraftService({ integrations: registry(calls) });
  const result = await service.draft({
    executionId: 'exec:finance-communication:1',
    correlationId: 'corr:finance-communication:1',
    decision: decision('AWAITING_VERIFIED_PAYMENT'),
  });

  assert.equal(result.policy.intent, 'DRAFT_PAYMENT_VERIFICATION_REQUEST');
  assert.equal(result.humanApprovalRequired, true);
  assert.equal(result.sendAuthorised, false);
  assert.equal(calls.length, 1);
  assert.ok(calls[0]!.context?.includes('Operational state: AWAITING_VERIFIED_PAYMENT'));
  assert.ok(calls[0]!.context?.includes('Communication intent: DRAFT_PAYMENT_VERIFICATION_REQUEST'));
  assert.ok(calls[0]!.systemInstruction?.includes('authoritative and immutable'));
});

test('Finance communication drafting blocks Gemini while verified evidence is still awaiting governed binding', async () => {
  const calls: ModelGenerationInput[] = [];
  const service = createFinanceGovernedCommunicationDraftService({ integrations: registry(calls) });

  await assert.rejects(
    () => service.draft({
      executionId: 'exec:finance-communication:2',
      correlationId: 'corr:finance-communication:2',
      decision: decision('READY_TO_BIND_REQUIREMENT', {
        paymentStatus: 'CONFIRMED',
        authorityState: 'AUTHORIZED',
        paymentEvidenceReference: 'payment-provider:paystack:event:1',
      }),
    }),
    /does not permit client-facing model drafting/,
  );
  assert.equal(calls.length, 0);
});

test('Finance payment confirmation drafting requires persisted clearance and remains approval-only', async () => {
  const calls: ModelGenerationInput[] = [];
  const service = createFinanceGovernedCommunicationDraftService({ integrations: registry(calls) });
  const result = await service.draft({
    executionId: 'exec:finance-communication:3',
    correlationId: 'corr:finance-communication:3',
    decision: decision('REQUIREMENT_SATISFIED', {
      clearanceId: 'finance-clearance:verified:1',
    }),
  });

  assert.equal(result.policy.intent, 'DRAFT_PAYMENT_CONFIRMATION');
  assert.deepEqual(result.policy.evidenceReferences, ['finance-clearance:verified:1']);
  assert.equal(result.humanApprovalRequired, true);
  assert.equal(result.sendAuthorised, false);
  assert.equal(calls.length, 1);
  assert.ok(calls[0]!.context?.includes('Clearance ID: finance-clearance:verified:1'));
});
