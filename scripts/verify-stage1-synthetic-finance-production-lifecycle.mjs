import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

import { AgentRuntimeHandlerRegistry } from '../apps/api/dist/agents/agent-runtime-handlers.js';
import { createFinancePaymentClearanceWorkflow } from '../apps/api/dist/agents/finance-payment-clearance-workflow.js';
import { createFinancePaymentEventWorkflow } from '../apps/api/dist/agents/finance-payment-event-workflow.js';
import { satisfyCommercialPaymentRequirement } from '../apps/api/dist/agents/finance-commercial-payment-requirement.js';
import { evaluateFinancePaymentLifecycle } from '../apps/api/dist/agents/finance-payment-lifecycle.js';
import { createPaystackPaymentWebhookIngress } from '../apps/api/dist/agents/paystack-payment-webhook-ingress.js';
import {
  PRODUCTION_TECHNICAL_ASSISTANCE_CAPABILITY,
  registerProductionModelCapabilities,
} from '../apps/api/dist/agents/production-model-capabilities.js';
import {
  createSyntheticProductionPlanEvidencePool,
  SYNTHETIC_PRODUCTION_PLAN_EXECUTION_ID,
} from '../apps/api/dist/agents/production-plan-test-fixture.js';
import { IntegrationRegistry } from '../apps/api/dist/integrations/integration-registry.js';
import { createPaystackPaymentIntegration } from '../apps/api/dist/integrations/paystack-payment-integration.js';

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const secretKey = `sk_test_stage1_${suffix}`;
const providerPaymentReference = `paystack-stage1-synthetic-${suffix}`;
const commercialRecordReference = `commercial:stage1:synthetic:${suffix}`;
const correlationId = `corr:stage1:synthetic:${suffix}`;
const amountMinor = 12500;
const currency = 'ZAR';
const paidAt = new Date().toISOString();
const clearanceIdExpectedPrefix = 'finance-clearance:';
const requirementReference = `requirement:stage1:synthetic:deposit:${suffix}`;

const operationsReadiness = {
  readinessId: `operations-readiness:stage1:synthetic:${suffix}`,
  commercialRecordReference,
  state: 'OPERATIONS_READY',
  contractSigned: true,
  onboardingComplete: true,
  assetsAvailable: true,
  planningComplete: true,
  evidenceReferences: [`operations:stage1:synthetic:${suffix}:ready`],
  approvedBy: 'operations_agent',
  approvedAt: paidAt,
};

function productionTask(clearanceId) {
  return {
    taskId: `task:stage1:synthetic:production:${suffix}`,
    executionId: `exec:stage1:synthetic:production:${suffix}`,
    originAgent: 'operations_agent',
    destinationAgent: 'production_agent',
    objective: 'Prove synthetic Finance and Operations authority reaches governed Production.',
    priority: 'normal',
    context: {
      financeClearanceId: clearanceId,
      operationsReadinessId: operationsReadiness.readinessId,
      commercialRecordReference,
      productionPlanExecutionId: SYNTHETIC_PRODUCTION_PLAN_EXECUTION_ID,
      environment: 'test',
      dataClass: 'synthetic',
    },
    knowledgeReferences: ['atlas://stage1/synthetic-finance-production'],
    inputs: {
      implementationBrief: 'Produce a deterministic synthetic technical draft only.',
    },
    expectedOutput: 'Technical implementation draft',
    dependencies: [],
    risks: [],
    confidence: 1,
    approvalRequired: false,
    status: 'ready',
    nextAction: 'execute_destination_capability',
    attempt: 1,
    maxAttempts: 1,
    correlationId,
    createdAt: paidAt,
    updatedAt: paidAt,
  };
}

console.log('\nAxorOS Stage 1 — Synthetic Finance → Operations → Production Lifecycle');
console.log('====================================================================');
console.log('Synthetic scenario only. Paystack and model providers are deterministic local fakes.\n');

const webhookRows = new Map();
const clearanceRows = new Map();
const paymentStateRows = new Map();

const webhookStore = {
  async save(evidence) {
    if (webhookRows.has(evidence.idempotencyKey)) return 'duplicate';
    webhookRows.set(evidence.idempotencyKey, evidence);
    return 'accepted';
  },
  async get(idempotencyKey) {
    return webhookRows.get(idempotencyKey) ?? null;
  },
};

const clearanceStore = {
  async save(decision) {
    if (clearanceRows.has(decision.clearanceId)) return 'duplicate';
    clearanceRows.set(decision.clearanceId, decision);
    return 'accepted';
  },
  async get(clearanceId) {
    return clearanceRows.get(clearanceId) ?? null;
  },
};

const currentStateStore = {
  async apply(evidence) {
    const lifecycle = evaluateFinancePaymentLifecycle(evidence);
    const state = {
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
  async get(provider, paymentReference) {
    return paymentStateRows.get(`${provider}:${paymentReference}`) ?? null;
  },
};

let verificationCalls = 0;
const paystack = createPaystackPaymentIntegration({
  secretKey,
  fetchImpl: async (url, init) => {
    verificationCalls += 1;
    assert.match(String(url), new RegExp(`/transaction/verify/${providerPaymentReference}$`));
    assert.equal(init?.method, 'GET');
    assert.equal(init?.headers?.Authorization, `Bearer ${secretKey}`);
    return new Response(
      JSON.stringify({
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
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
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
assert.ok(clearanceId.startsWith(clearanceIdExpectedPrefix));
assert.equal(eventResult.clearance?.decision.commercialRecordReference, commercialRecordReference);

console.log('[1] Synthetic signed payment evidence accepted and independently verified.');
console.log(`    providerPaymentReference: ${providerPaymentReference}`);
console.log('[2] Finance clearance created for the same commercial record.');
console.log(`    clearanceId: ${clearanceId}`);

const requirement = {
  commercialRecordReference,
  gate: 'PRODUCTION_START',
  requirementReference,
  requirementType: 'DEPOSIT',
  requiredAmountMinor: amountMinor,
  currency,
  status: 'ACTIVE',
};
let satisfaction = null;
const requirementStore = {
  async get(recordReference, gate) {
    return recordReference === commercialRecordReference && gate === 'PRODUCTION_START' ? requirement : null;
  },
};
const satisfactionStore = {
  async save(value) {
    if (satisfaction) return 'duplicate';
    satisfaction = value;
    return 'accepted';
  },
  async get(reference) {
    return satisfaction?.requirementReference === reference ? satisfaction : null;
  },
};

const satisfactionResult = await satisfyCommercialPaymentRequirement(
  { requirementStore, satisfactionStore, clearanceStore },
  { commercialRecordReference, gate: 'PRODUCTION_START', clearanceId },
);
assert.equal(satisfactionResult.persistence, 'accepted');
assert.equal(satisfactionResult.satisfaction.requirementReference, requirementReference);
assert.equal(satisfactionResult.satisfaction.commercialRecordReference, commercialRecordReference);

console.log('[3] PRODUCTION_START payment requirement satisfied by governed Finance clearance.');

let modelCalls = 0;
const model = {
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
      output: {
        text: 'Synthetic governed Production draft.',
        model: 'synthetic-stage1-model',
        finishReason: 'stop',
      },
      evidenceReferences: [`model:synthetic-stage1:${suffix}:production`],
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
  {
    async get(id) {
      return id === operationsReadiness.readinessId ? operationsReadiness : null;
    },
  },
  createSyntheticProductionPlanEvidencePool(commercialRecordReference),
);

const productionHandler = handlers.get(
  'production_agent',
  PRODUCTION_TECHNICAL_ASSISTANCE_CAPABILITY,
);
assert.ok(productionHandler);

const productionResult = await productionHandler.execute(productionTask(clearanceId));
assert.equal(productionResult.status, 'completed');
assert.equal(modelCalls, 1);
assert.equal(productionResult.output.provider, 'synthetic-stage1-model');

console.log('[4] Matching Operations readiness combined with Finance authority.');
console.log('[5] Governed Production capability executed exactly once.');
console.log(`    commercialRecordReference: ${commercialRecordReference}`);
console.log(`    correlationId: ${correlationId}`);

console.log('\nSTOP: no real Paystack, Gmail, Cloudflare, or external model call occurred.');
console.log('PASS  Synthetic Finance → Operations → Production lifecycle preserved commercial authority and reached governed Production without external side effects.\n');
