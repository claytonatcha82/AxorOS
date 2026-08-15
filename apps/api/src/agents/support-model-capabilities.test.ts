import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentRuntimeTask } from './agent-runtime-contract.js';
import { AgentRuntimeHandlerRegistry } from './agent-runtime-handlers.js';
import { SUPPORT_INCIDENT_ANALYSIS_CAPABILITY, registerSupportModelCapabilities } from './support-model-capabilities.js';
import type { ExternalIntegration } from '../integrations/integration-contract.js';
import { IntegrationRegistry } from '../integrations/integration-registry.js';
import type { ModelGenerationInput, ModelGenerationOutput } from '../integrations/model-integration.js';

function task(): AgentRuntimeTask {
  return {
    taskId: 'task-support-model-1',
    executionId: 'exec-support-model-1',
    originAgent: 'operations_agent',
    destinationAgent: 'support_agent',
    objective: 'Analyse a synthetic support incident',
    priority: 'normal',
    context: { dataClass: 'synthetic' },
    knowledgeReferences: ['atlas://support/incident-policy'],
    inputs: {
      incidentBrief: 'Analyse a report that the synthetic website is intermittently unavailable.',
      supportContext: 'Synthetic test only. No verified root cause, remediation, or restoration evidence is available.',
    },
    expectedOutput: 'Incident analysis',
    dependencies: [],
    risks: [],
    confidence: 0.8,
    approvalRequired: false,
    status: 'ready',
    nextAction: 'execute_destination_capability',
    attempt: 1,
    maxAttempts: 3,
    correlationId: 'corr-support-model-1',
    createdAt: '2026-08-15T10:58:00.000Z',
    updatedAt: '2026-08-15T10:58:00.000Z',
  };
}

test('Support Agent Gemini capability remains draft-only and evidence-bound', async () => {
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
          text: 'Likely cause is unverified. Confirm current service state and logs before remediation.',
          model: 'gemini-3.5-flash-lite',
          finishReason: 'stop',
          inputTokens: 42,
          outputTokens: 16,
        },
        evidenceReferences: ['mock:support:synthetic'],
        retryable: false,
      };
    },
  };

  const integrations = new IntegrationRegistry();
  integrations.register(gemini);

  const handlers = new AgentRuntimeHandlerRegistry();
  registerSupportModelCapabilities(handlers, integrations);
  const handler = handlers.get('support_agent', SUPPORT_INCIDENT_ANALYSIS_CAPABILITY);
  assert.ok(handler);

  const result = await handler.execute(task());

  assert.equal(result.status, 'completed');
  assert.equal(result.agentId, 'support_agent');
  assert.equal(result.output.integrationId, 'model.gemini');
  assert.equal(result.output.provider, 'google-gemini');
  assert.equal(result.output.mode, 'draft');
  assert.deepEqual(result.knowledgeReferences, ['atlas://support/incident-policy']);
  assert.deepEqual(result.evidenceReferences, ['mock:support:synthetic', 'integration:model.gemini']);

  assert.equal(capturedInput?.prompt, 'Analyse a report that the synthetic website is intermittently unavailable.');
  assert.equal(capturedInput?.context, 'Synthetic test only. No verified root cause, remediation, or restoration evidence is available.');
  assert.match(capturedInput?.systemInstruction ?? '', /Do not claim an incident is resolved/);
  assert.match(capturedInput?.systemInstruction ?? '', /Do not modify production/);
  assert.match(capturedInput?.systemInstruction ?? '', /Respect client entitlements and isolation boundaries/);
  assert.match(capturedInput?.systemInstruction ?? '', /Escalate security, legal, financial, data-loss/);
  assert.equal(capturedInput?.maxOutputTokens, 768);
  assert.equal(capturedInput?.temperature, 0.2);
});
