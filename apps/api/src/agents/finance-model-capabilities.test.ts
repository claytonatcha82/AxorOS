import assert from 'node:assert/strict';
import test from 'node:test';
import { AgentRuntimeHandlerRegistry } from './agent-runtime-handlers.js';
import { FINANCE_ANALYSIS_CAPABILITY, registerFinanceModelCapabilities } from './finance-model-capabilities.js';
import type { ExternalIntegration } from '../integrations/integration-contract.js';
import { IntegrationRegistry } from '../integrations/integration-registry.js';
import type { ModelGenerationInput, ModelGenerationOutput } from '../integrations/model-integration.js';

test('Finance Agent Gemini capability remains draft-only and provider-evidence-bound', async () => {
  let capturedInput: ModelGenerationInput | undefined;

  const gemini: ExternalIntegration<ModelGenerationInput, ModelGenerationOutput> = {
    integrationId: 'model.gemini',
    kind: 'model',
    provider: 'google-gemini',
    supportedModes: ['draft'],
    supportedOperations: ['generate_text'],
    async execute(request) {
      capturedInput = request.input;
      return {
        integrationId: 'model.gemini',
        operation: request.operation,
        provider: 'google-gemini',
        mode: request.mode,
        status: 'drafted',
        output: {
          text: 'The supplied ledger shows an outstanding invoice. A client statement alone is not evidence of payment confirmation or settlement; verified provider evidence is still required.',
          model: 'gemini-3.5-flash-lite',
          finishReason: 'stop',
          inputTokens: 48,
          outputTokens: 29,
        },
        evidenceReferences: ['mock:finance:synthetic'],
        retryable: false,
      };
    },
  };

  const integrations = new IntegrationRegistry();
  integrations.register(gemini);
  const handlers = new AgentRuntimeHandlerRegistry();
  registerFinanceModelCapabilities(handlers, integrations);

  const handler = handlers.get('finance_agent', FINANCE_ANALYSIS_CAPABILITY);
  assert.ok(handler);

  const result = await handler.execute({
    taskId: 'task-finance-capability-1',
    executionId: 'exec-finance-capability-1',
    originAgent: 'operations_agent',
    destinationAgent: 'finance_agent',
    objective: 'Analyse synthetic invoice and payment evidence',
    priority: 'normal',
    context: { environment: 'test', dataClass: 'synthetic' },
    knowledgeReferences: ['atlas://finance/synthetic-payment-policy'],
    inputs: {
      financeBrief: 'Determine what can safely be concluded about this synthetic invoice.',
      financeContext: 'Ledger status is outstanding. Client says payment was sent. No verified payment-provider confirmation or settlement evidence is supplied.',
    },
    expectedOutput: 'Financial analysis for internal review',
    dependencies: [],
    risks: [],
    confidence: 0.9,
    approvalRequired: false,
    status: 'in_progress',
    nextAction: 'execute_destination_capability',
    attempt: 1,
    maxAttempts: 3,
    correlationId: 'corr-finance-capability-1',
    createdAt: '2026-08-15T11:17:00.000Z',
    updatedAt: '2026-08-15T11:17:00.000Z',
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.agentId, 'finance_agent');
  assert.deepEqual(result.knowledgeReferences, ['atlas://finance/synthetic-payment-policy']);
  assert.deepEqual(result.evidenceReferences, ['mock:finance:synthetic']);
  assert.equal(result.output.integrationId, 'model.gemini');
  assert.equal(result.output.mode, 'draft');
  assert.equal(capturedInput?.prompt, 'Determine what can safely be concluded about this synthetic invoice.');
  assert.match(capturedInput?.context ?? '', /No verified payment-provider confirmation or settlement evidence/);
  assert.match(capturedInput?.systemInstruction ?? '', /distinct states and must never be conflated/);
  assert.match(capturedInput?.systemInstruction ?? '', /Only verified payment-provider evidence/);
  assert.match(capturedInput?.systemInstruction ?? '', /Do not create or authorize payments/);
  assert.match(capturedInput?.systemInstruction ?? '', /Do not alter the ledger/);
  assert.equal(capturedInput?.temperature, 0.1);
  assert.equal(capturedInput?.maxOutputTokens, 896);
});
