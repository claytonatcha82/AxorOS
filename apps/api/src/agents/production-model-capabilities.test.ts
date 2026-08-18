import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentRuntimeTask } from './agent-runtime-contract.js';
import { AgentRuntimeHandlerRegistry } from './agent-runtime-handlers.js';
import { PRODUCTION_TECHNICAL_ASSISTANCE_CAPABILITY, registerProductionModelCapabilities } from './production-model-capabilities.js';
import type { PersistedFinanceClearanceDecision } from '../data/finance-clearance-postgres-store.js';
import type { ExternalIntegration } from '../integrations/integration-contract.js';
import { IntegrationRegistry } from '../integrations/integration-registry.js';
import type { ModelGenerationInput, ModelGenerationOutput } from '../integrations/model-integration.js';

const clearance: PersistedFinanceClearanceDecision = {
  clearanceId: 'clearance:synthetic:production-model-1',
  commercialRecordReference: 'commercial:synthetic:production-model-1',
  providerPaymentReference: 'payment:synthetic:production-model-1',
  state: 'FINANCE_CLEARED',
  reason: 'Synthetic provider evidence matched.',
  evidenceReferences: ['payment-provider:synthetic:production-model-1'],
  amountMinor: 10000,
  currency: 'ZAR',
  verifiedAt: '2026-08-18T08:50:00.000Z',
};

function task(): AgentRuntimeTask {
  return {
    taskId: 'task-production-model-1', executionId: 'exec-production-model-1', originAgent: 'operations_agent', destinationAgent: 'production_agent',
    objective: 'Draft a synthetic technical implementation plan', priority: 'normal',
    context: { environment: 'test', dataClass: 'synthetic', financeClearanceId: clearance.clearanceId, commercialRecordReference: clearance.commercialRecordReference },
    knowledgeReferences: ['atlas://production/synthetic-requirements'],
    inputs: { implementationBrief: 'Draft a component implementation plan for a synthetic brochure website.', technicalContext: 'Synthetic project only. Requirements are supplied for planning; no deployment or production authorization is granted.' },
    expectedOutput: 'Technical implementation draft', dependencies: [], risks: [], confidence: 0.95, approvalRequired: false,
    status: 'ready', nextAction: 'execute_destination_capability', attempt: 1, maxAttempts: 3, correlationId: 'corr-production-model-1',
    createdAt: '2026-08-18T08:50:00.000Z', updatedAt: '2026-08-18T08:50:00.000Z',
  };
}

test('Production Agent registers a governed Gemini technical-assistance capability', async () => {
  let capturedInput: ModelGenerationInput | undefined;
  const gemini: ExternalIntegration<ModelGenerationInput, ModelGenerationOutput> = {
    integrationId: 'model.gemini', kind: 'model', provider: 'google-gemini', supportedModes: ['draft'], supportedOperations: ['generate_text'],
    async execute(request) {
      capturedInput = request.input;
      return { integrationId: 'model.gemini', operation: request.operation, provider: 'google-gemini', mode: request.mode, status: 'drafted', output: { text: 'Synthetic technical implementation plan.', model: 'gemini-3.5-flash-lite', finishReason: 'stop', inputTokens: 44, outputTokens: 18 }, evidenceReferences: ['gemini:production-capability:synthetic'], retryable: false };
    },
  };

  const integrations = new IntegrationRegistry(); integrations.register(gemini);
  const handlers = new AgentRuntimeHandlerRegistry();
  registerProductionModelCapabilities(handlers, integrations, { async get(id) { return id === clearance.clearanceId ? clearance : null; } });

  const handler = handlers.get('production_agent', PRODUCTION_TECHNICAL_ASSISTANCE_CAPABILITY); assert.ok(handler);
  const result = await handler.execute(task());
  assert.equal(result.status, 'completed'); assert.equal(result.agentId, 'production_agent');
  assert.equal(result.output.integrationId, 'model.gemini'); assert.equal(result.output.provider, 'google-gemini'); assert.equal(result.output.mode, 'draft');
  assert.deepEqual(result.knowledgeReferences, ['atlas://production/synthetic-requirements']);
  assert.equal(capturedInput?.prompt, 'Draft a component implementation plan for a synthetic brochure website.');
  assert.match(capturedInput?.systemInstruction ?? '', /Do not deploy, publish, merge, push/);
  assert.match(capturedInput?.systemInstruction ?? '', /Do not claim QA passed/);
  assert.match(capturedInput?.systemInstruction ?? '', /Respect the Production start gate/);
  assert.match(capturedInput?.systemInstruction ?? '', /Do not invent client facts/);
});
