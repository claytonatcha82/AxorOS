import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import type { AgentRuntimeTask } from './agent-runtime-contract.js';
import { AgentRuntimeHandlerRegistry } from './agent-runtime-handlers.js';
import { createFinancePaymentClearanceWorkflow } from './finance-payment-clearance-workflow.js';
import { createFinancePaymentEventWorkflow } from './finance-payment-event-workflow.js';
import { satisfyCommercialPaymentRequirement } from './finance-commercial-payment-requirement.js';
import { evaluateFinancePaymentLifecycle } from './finance-payment-lifecycle.js';
import { createPaystackPaymentWebhookIngress } from './paystack-payment-webhook-ingress.js';
import { PRODUCTION_TECHNICAL_ASSISTANCE_CAPABILITY, registerProductionModelCapabilities } from './production-model-capabilities.js';
import type { PersistedFinanceClearanceDecision } from '../data/finance-clearance-postgres-store.js';
import type { PersistedFinancePaymentCurrentState } from '../data/finance-payment-current-state-postgres-store.js';
import type { PaymentWebhookEvidence } from '../integrations/payment-webhook-evidence.js';
import type { ExternalIntegration } from '../integrations/integration-contract.js';
import { IntegrationRegistry } from '../integrations/integration-registry.js';
import type { ModelGenerationInput, ModelGenerationOutput } from '../integrations/model-integration.js';
import { createPaystackPaymentIntegration } from '../integrations/paystack-payment-integration.js';

const secretKey = 'sk_test_synthetic_stage1_paystack';
const providerPaymentReference = 'paystack-stage1-synthetic-1';
const commercialRecordReference = 'commercial:stage1:synthetic:1';
const amountMinor = 12500;
const currency = 'ZAR';
const paidAt = '2026-08-18T19:00:00.000Z';

function productionTask(clearanceId: string): AgentRuntimeTask {
  return {
    taskId: 'task-stage1-paystack-production',
    executionId: 'exec-stage1-paystack-production',
    originAgent: 'operations_agent',
    destinationAgent: 'production_agent',
    objective: 'Prove synthetic Paystack Finance authority reaches governed Production.',
    priority: 'normal',
    context: {
      financeClearanceId: clearanceId,
      commercialRecordReference,
      environment: 'test',
      dataClass: 'synthetic',
    },
    knowledgeReferences: ['atlas://finance/payment-gates'],
    inputs: { implementationBrief: 'Produce a deterministic synthetic technical draft only.' },
    expectedOutput: 'Technical implementation draft',
    dependencies: [],
    risks: [],
    confidence: 1,
    approvalRequired: false,
    status: 'ready',
    nextAction: 'execute_destination_capability',
    attempt: 1,
    maxAttempts: 1,
    correlationId: 'corr-stage1-paystack-production',
    createdAt: paidAt,
    updatedAt: paidAt,
  };
}

test('signed Paystack webhook independently verifies payment, clears Finance, satisfies PRODUCTION_START, and authorizes Production', async () => {
  const webhookRows = new Map<string, PaymentWebhookEvidence>();
  const clearanceRows = new Map<string, PersistedFinanceClearanceDecision>();
  const paymentStateRows = new Map<string, PersistedFinancePaymentCurrentState>();

  const webhookStore = {
    async save(evidence: PaymentWebhookEvidence): Promise<'accepted' | 'duplicate'> {
      if (webhookRows.has(evidence.idempotencyKey)) return 'duplicate';
      webhookRows.set(evidence.idempotencyKey, evidence);
      return 'accepted';
    },
    async get(idempotencyKey: string): Promise<PaymentWebhookEvidence | null> {
      return webhookRows.get(idempotencyKey) ?? null;
    },
  };

  const clearanceStore = {
    async save(decision: PersistedFinanceClearanceDecision): Promise<'accepted' | 'duplicate'> {
      if (clearanceRows.has(decision.clearanceId)) return 'duplicate';
      clearanceRows.set(decision.clearanceId, decision);
      return 'accepted';
    },
    async get(clearanceId: string): Promise<PersistedFinanceClearanceDecision | null> {
      return clearanceRows.get(clearanceId) ?? null;
    },
  };

  const currentStateStore = {
    async apply(evidence: PaymentWebhookEvidence): Promise<'accepted'> {
      const lifecycle = evaluateFinancePaymentLifecycle(evidence);
      const state: PersistedFinancePaymentCurrentState = {
        provider: evidence.provider,
        providerPaymentReference: evidence.providerPaymentReference,
        commercialRecordReference: evidence.commercialRecordReference,
        paymentStatus: lifecycle.paymentStatus,
        authorityState: lifecycle.authorityState,
        reason: lifecycle.reason,
        latestEventType: evidence.eventType,
        latestProviderEventReference: evidence.providerEventReference,
        latestEvidenceReference: evidence.evidenceReference,
        latestOccurredAt: lifecycle.occurredAt,
        ...(evidence.amountMinor !== undefined ? { amountMinor: evidence.amountMinor } : {}),
        ...(evidence.currency !== undefined ? { currency: evidence.currency } : {}),
      };
      paymentStateRows.set(`${evidence.provider}:${evidence.providerPaymentReference}`, state);
      return 'accepted';
    },
    async get(provider: string, paymentReference: string): Promise<PersistedFinancePaymentCurrentState | null> {
      return paymentStateRows.get(`${provider}:${paymentReference}`) ?? null;
    },
  };

  let verificationCalls = 0;
  const paystack = createPaystackPaymentIntegration({
    secretKey,
    fetchImpl: async (url, init) => {
      verificationCalls += 1;
      assert.match(String(url), /\/transaction\/verify\/paystack-stage1-synthetic-1$/);
      assert.equal(init?.method, 'GET');
      assert.equal((init?.headers as Record<string, string> | undefined)?.Authorization, `Bearer ${secretKey}`);
      return new Response(JSON.stringify({
        status: true,
        message: 'Verification successful',
        data: {
          id: 9001,
          status: 'success',
          reference: providerPaymentReference,
          amount: amountMinor,
          currency,
          paid_at: paidAt,
          created_at: paidAt,
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });

  const integrations = new IntegrationRegistry();
  integrations.register(paystack);

  const clearanceWorkflow = createFinancePaymentClearanceWorkflow({
    integrations,
    clearanceStore,
    paymentWebhookEvidenceStore: webhookStore,
  });
  const eventWorkflow = createFinancePaymentEventWorkflow({
    webhookStore,
    currentStateStore,
    clearanceWorkflow,
    paymentIntegrationId: 'payment.paystack',
    mode: 'sandbox',
  });
  const ingress = createPaystackPaymentWebhookIngress({
    secretKey,
    currentStateStore,
    eventWorkflow,
  });

  const rawBody = Buffer.from(JSON.stringify({
    event: 'charge.success',
    data: {
      id: 7001,
      reference: providerPaymentReference,
      amount: amountMinor,
      currency,
      paid_at: paidAt,
      metadata: { axorosCommercialRecordReference: commercialRecordReference },
    },
  }));
  const signature = createHmac('sha512', secretKey).update(rawBody).digest('hex');
  const eventResult = await ingress.ingest({ rawBody, signature });

  assert.equal(verificationCalls, 1);
  assert.equal(eventResult.webhookPersistence, 'accepted');
  assert.equal(eventResult.currentStatePersistence, 'accepted');
  assert.equal(eventResult.clearance?.decision.state, 'FINANCE_CLEARED');
  const clearanceId = eventResult.clearance?.decision.clearanceId;
  assert.ok(clearanceId);
  assert.deepEqual(eventResult.clearance?.decision.evidenceReferences, [
    `payment-provider:paystack:charge.success:${providerPaymentReference}`,
    `payment-paystack-verify:transaction:9001:${providerPaymentReference}`,
  ]);

  const requirement = {
    commercialRecordReference,
    gate: 'PRODUCTION_START' as const,
    requirementReference: 'requirement:stage1:synthetic:deposit',
    requirementType: 'DEPOSIT' as const,
    requiredAmountMinor: amountMinor,
    currency,
    status: 'ACTIVE' as const,
  };
  let satisfaction: {
    requirementReference: string;
    clearanceId: string;
    commercialRecordReference: string;
    gate: 'PRODUCTION_START';
    satisfiedAt: string;
  } | null = null;

  const requirementStore = {
    async get(recordReference: string, gate: string) {
      return recordReference === commercialRecordReference && gate === 'PRODUCTION_START' ? requirement : null;
    },
  };
  const satisfactionStore = {
    async save(value: NonNullable<typeof satisfaction>): Promise<'accepted' | 'duplicate'> {
      if (satisfaction) return 'duplicate';
      satisfaction = value;
      return 'accepted';
    },
    async get(requirementReference: string): Promise<NonNullable<typeof satisfaction> | null> {
      return satisfaction?.requirementReference === requirementReference ? satisfaction : null;
    },
  };

  const satisfactionResult = await satisfyCommercialPaymentRequirement({
    requirementStore,
    satisfactionStore,
    clearanceStore,
  }, {
    commercialRecordReference,
    gate: 'PRODUCTION_START',
    clearanceId,
  });
  assert.equal(satisfactionResult.persistence, 'accepted');
  assert.equal(satisfactionResult.satisfaction.requirementReference, requirement.requirementReference);

  let modelCalls = 0;
  const model: ExternalIntegration<ModelGenerationInput, ModelGenerationOutput> = {
    integrationId: 'model.gemini',
    kind: 'model',
    provider: 'synthetic-stage1-model',
    supportedModes: ['draft'],
    supportedOperations: ['generate_text'],
    async execute(request) {
      modelCalls += 1;
      return {
        integrationId: 'model.gemini',
        operation: request.operation,
        provider: 'synthetic-stage1-model',
        mode: request.mode,
        status: 'drafted',
        output: { text: 'Synthetic governed Production draft.', model: 'synthetic-stage1-model', finishReason: 'stop' },
        evidenceReferences: ['model:synthetic-stage1:production'],
        retryable: false,
      };
    },
  };
  integrations.register(model);

  const handlers = new AgentRuntimeHandlerRegistry();
  registerProductionModelCapabilities(
    handlers,
    integrations,
    clearanceStore,
    currentStateStore,
    requirementStore,
    satisfactionStore,
  );
  const productionHandler = handlers.get('production_agent', PRODUCTION_TECHNICAL_ASSISTANCE_CAPABILITY);
  assert.ok(productionHandler);

  const productionResult = await productionHandler.execute(productionTask(clearanceId));
  assert.equal(productionResult.status, 'completed');
  assert.equal(modelCalls, 1);
  assert.equal(productionResult.output.provider, 'synthetic-stage1-model');
});
