import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentRuntimeTask } from './agent-runtime-contract.js';
import { AgentRuntimeHandlerRegistry } from './agent-runtime-handlers.js';
import { PRODUCTION_TECHNICAL_ASSISTANCE_CAPABILITY, registerProductionModelCapabilities } from './production-model-capabilities.js';
import type { PersistedFinanceClearanceDecision } from '../data/finance-clearance-postgres-store.js';
import type { PersistedFinancePaymentCurrentState } from '../data/finance-payment-current-state-postgres-store.js';
import type { OperationsProductionReadinessDecision } from '../data/operations-production-readiness-postgres-store.js';
import type { ExternalIntegration } from '../integrations/integration-contract.js';
import { IntegrationRegistry } from '../integrations/integration-registry.js';
import type { ModelGenerationInput, ModelGenerationOutput } from '../integrations/model-integration.js';

const clearance: PersistedFinanceClearanceDecision = {
  clearanceId: 'clearance:synthetic:production-model-1', commercialRecordReference: 'commercial:synthetic:production-model-1',
  providerPaymentReference: 'payment:synthetic:production-model-1', state: 'FINANCE_CLEARED', reason: 'Synthetic provider evidence matched.',
  evidenceReferences: ['payment-provider:synthetic:production-model-1'], amountMinor: 10000, currency: 'ZAR', verifiedAt: '2026-08-18T08:50:00.000Z',
};
const readiness: OperationsProductionReadinessDecision = {
  readinessId: 'operations-readiness:synthetic:production-model-1', commercialRecordReference: clearance.commercialRecordReference,
  state: 'OPERATIONS_READY', contractSigned: true, onboardingComplete: true, assetsAvailable: true, planningComplete: true,
  evidenceReferences: ['operations:synthetic:production-model-1'], approvedBy: 'operations_agent', approvedAt: clearance.verifiedAt,
};
const paymentState: PersistedFinancePaymentCurrentState = {
  provider: 'synthetic', providerPaymentReference: clearance.providerPaymentReference, commercialRecordReference: clearance.commercialRecordReference,
  paymentStatus: 'CONFIRMED', authorityState: 'AUTHORIZED', reason: 'Synthetic current payment state remains authorized.', latestEventType: 'payment_paid',
  latestProviderEventReference: 'event:synthetic:production-model-1', latestEvidenceReference: clearance.evidenceReferences[0]!, latestOccurredAt: clearance.verifiedAt,
  amountMinor: clearance.amountMinor, currency: clearance.currency,
};
const requirement = { commercialRecordReference: clearance.commercialRecordReference, gate: 'PRODUCTION_START' as const, requirementReference: 'requirement:synthetic:production-model-1', requirementType: 'DEPOSIT' as const, requiredAmountMinor: 10000, currency: 'ZAR', status: 'ACTIVE' as const };
const satisfaction = { requirementReference: requirement.requirementReference, clearanceId: clearance.clearanceId, commercialRecordReference: clearance.commercialRecordReference, gate: 'PRODUCTION_START' as const, satisfiedAt: clearance.verifiedAt };

function task(): AgentRuntimeTask {
  return {
    taskId: 'task-production-model-1', executionId: 'exec-production-model-1', originAgent: 'operations_agent', destinationAgent: 'production_agent',
    objective: 'Draft a synthetic technical implementation plan', priority: 'normal',
    context: { environment: 'test', dataClass: 'synthetic', financeClearanceId: clearance.clearanceId, operationsReadinessId: readiness.readinessId, commercialRecordReference: clearance.commercialRecordReference },
    knowledgeReferences: ['atlas://production/synthetic-requirements'], inputs: { implementationBrief: 'Draft a component implementation plan for a synthetic brochure website.', technicalContext: 'Synthetic project only.' },
    expectedOutput: 'Technical implementation draft', dependencies: [], risks: [], confidence: 0.95, approvalRequired: false, status: 'ready', nextAction: 'execute_destination_capability', attempt: 1, maxAttempts: 3, correlationId: 'corr-production-model-1', createdAt: clearance.verifiedAt, updatedAt: clearance.verifiedAt,
  };
}

test('Production Agent registers a governed Gemini technical-assistance capability', async () => {
  let capturedInput: ModelGenerationInput | undefined;
  const gemini: ExternalIntegration<ModelGenerationInput, ModelGenerationOutput> = {
    integrationId: 'model.gemini', kind: 'model', provider: 'google-gemini', supportedModes: ['draft'], supportedOperations: ['generate_text'],
    async execute(request) { capturedInput = request.input; return { integrationId: 'model.gemini', operation: request.operation, provider: 'google-gemini', mode: request.mode, status: 'drafted', output: { text: 'Synthetic technical implementation plan.', model: 'gemini-3.5-flash-lite', finishReason: 'stop', inputTokens: 44, outputTokens: 18 }, evidenceReferences: ['gemini:production-capability:synthetic'], retryable: false }; },
  };
  const integrations = new IntegrationRegistry(); integrations.register(gemini);
  const handlers = new AgentRuntimeHandlerRegistry();
  registerProductionModelCapabilities(handlers, integrations,
    { async get(id) { return id === clearance.clearanceId ? clearance : null; } },
    { async get(_provider, providerPaymentReference) { return providerPaymentReference === clearance.providerPaymentReference ? paymentState : null; } },
    { async get() { return requirement; } }, { async get() { return satisfaction; } },
    { async get(id) { return id === readiness.readinessId ? readiness : null; } },
  );
  const handler = handlers.get('production_agent', PRODUCTION_TECHNICAL_ASSISTANCE_CAPABILITY); assert.ok(handler);
  const result = await handler.execute(task());
  assert.equal(result.status, 'completed'); assert.equal(result.agentId, 'production_agent');
  assert.equal(result.output.integrationId, 'model.gemini'); assert.equal(capturedInput?.prompt, 'Draft a component implementation plan for a synthetic brochure website.');
  assert.match(capturedInput?.systemInstruction ?? '', /Do not deploy, publish, merge, push/);
  assert.match(capturedInput?.systemInstruction ?? '', /trusted Finance and Operations evidence/);
});
