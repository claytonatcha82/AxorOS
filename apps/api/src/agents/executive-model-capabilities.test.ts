import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentRuntimeTask } from './agent-runtime-contract.js';
import { AgentRuntimeHandlerRegistry } from './agent-runtime-handlers.js';
import { EXECUTIVE_STRATEGIC_ANALYSIS_CAPABILITY, registerExecutiveModelCapabilities } from './executive-model-capabilities.js';
import type { ExternalIntegration } from '../integrations/integration-contract.js';
import { IntegrationRegistry } from '../integrations/integration-registry.js';
import type { ModelGenerationInput, ModelGenerationOutput } from '../integrations/model-integration.js';

function task(): AgentRuntimeTask {
  return {
    taskId: 'task-executive-model-1',
    executionId: 'exec-executive-model-1',
    originAgent: 'operations_agent',
    destinationAgent: 'executive_agent',
    objective: 'Analyse a synthetic strategic decision',
    priority: 'high',
    context: { environment: 'test', dataClass: 'synthetic' },
    knowledgeReferences: ['atlas://executive/decision-governance'],
    inputs: {
      decisionBrief: 'Compare two synthetic growth options and recommend which should proceed to Human Executive review.',
      strategicContext: 'Synthetic scenario only. Option A has lower cost and lower expected reach. Option B has higher cost and higher uncertainty. No spending, policy change, or approval is authorized.',
    },
    expectedOutput: 'Strategic decision analysis',
    dependencies: [],
    risks: ['material_financial_commitment'],
    confidence: 0.86,
    approvalRequired: false,
    status: 'ready',
    nextAction: 'execute_destination_capability',
    attempt: 1,
    maxAttempts: 3,
    correlationId: 'corr-executive-model-1',
    createdAt: '2026-08-15T11:12:00.000Z',
    updatedAt: '2026-08-15T11:12:00.000Z',
  };
}

test('Executive Agent registers governed Gemini strategic-analysis capability', async () => {
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
          text: 'Option A is more reversible and lower cost; verify assumptions and submit the recommendation for Human Executive review before any commitment.',
          model: 'gemini-3.5-flash-lite',
          finishReason: 'stop',
          inputTokens: 56,
          outputTokens: 24,
        },
        evidenceReferences: ['gemini:executive-capability:synthetic'],
        retryable: false,
      };
    },
  };

  const integrations = new IntegrationRegistry();
  integrations.register(gemini);
  const handlers = new AgentRuntimeHandlerRegistry();
  registerExecutiveModelCapabilities(handlers, integrations);

  const handler = handlers.get('executive_agent', EXECUTIVE_STRATEGIC_ANALYSIS_CAPABILITY);
  assert.ok(handler);

  const result = await handler.execute(task());
  assert.equal(result.status, 'completed');
  assert.equal(result.agentId, 'executive_agent');
  assert.equal(result.output.integrationId, 'model.gemini');
  assert.equal(result.output.provider, 'google-gemini');
  assert.equal(result.output.mode, 'draft');
  assert.deepEqual(result.knowledgeReferences, ['atlas://executive/decision-governance']);

  assert.equal(capturedInput?.prompt, 'Compare two synthetic growth options and recommend which should proceed to Human Executive review.');
  assert.match(capturedInput?.systemInstruction ?? '', /Do not change policy/);
  assert.match(capturedInput?.systemInstruction ?? '', /require Human Executive review and approval/);
  assert.match(capturedInput?.systemInstruction ?? '', /Do not override Human Executive decisions/);
  assert.match(capturedInput?.systemInstruction ?? '', /Treat recommendations as advisory analysis/);
  assert.equal(capturedInput?.maxOutputTokens, 896);
  assert.equal(capturedInput?.temperature, 0.2);
});
