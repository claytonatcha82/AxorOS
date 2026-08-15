import assert from 'node:assert/strict';
import test from 'node:test';
import { AgentRuntimeHandlerRegistry } from './agent-runtime-handlers.js';
import { SUPPORT_INCIDENT_ANALYSIS_CAPABILITY, registerSupportModelCapabilities } from './support-model-capabilities.js';
import type { IntegrationAdapter, IntegrationRequest } from '../integrations/integration-contract.js';
import { IntegrationRegistry } from '../integrations/integration-registry.js';
import type { ModelGenerationInput, ModelGenerationOutput } from '../integrations/model-integration.js';

class MockGeminiAdapter implements IntegrationAdapter<ModelGenerationInput, ModelGenerationOutput> {
  readonly integrationId = 'model.gemini';
  readonly kind = 'model' as const;
  readonly provider = 'google-gemini';
  readonly supportedModes = ['draft'] as const;
  readonly supportedOperations = ['generate_text'] as const;
  request?: IntegrationRequest<ModelGenerationInput>;

  async execute(request: IntegrationRequest<ModelGenerationInput>) {
    this.request = request;
    return {
      integrationId: this.integrationId,
      operation: request.operation,
      provider: this.provider,
      mode: request.mode,
      status: 'drafted' as const,
      output: {
        text: 'Likely cause is unverified. Confirm current service state and logs before remediation.',
        model: 'gemini-3.5-flash-lite',
      },
      evidenceReferences: ['mock:support:synthetic'],
      retryable: false,
    };
  }
}

test('Support Agent Gemini capability remains draft-only and evidence-bound', async () => {
  const integrations = new IntegrationRegistry();
  const gemini = new MockGeminiAdapter();
  integrations.register(gemini);

  const handlers = new AgentRuntimeHandlerRegistry();
  registerSupportModelCapabilities(handlers, integrations);
  const handler = handlers.require('support_agent', SUPPORT_INCIDENT_ANALYSIS_CAPABILITY);

  const result = await handler.execute({
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
    status: 'in_progress',
    nextAction: 'execute_destination_capability',
    attempt: 1,
    maxAttempts: 3,
    correlationId: 'corr-support-model-1',
    createdAt: '2026-08-15T10:58:00.000Z',
    updatedAt: '2026-08-15T10:58:00.000Z',
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.agentId, 'support_agent');
  assert.deepEqual(result.evidenceReferences, ['mock:support:synthetic', 'integration:model.gemini']);
  assert.equal(gemini.request?.operation, 'generate_text');
  assert.equal(gemini.request?.requestedBy, 'support_agent');
  assert.equal(gemini.request?.mode, 'draft');
  assert.equal(gemini.request?.risk, 'low');
  assert.equal(gemini.request?.input.prompt, 'Analyse a report that the synthetic website is intermittently unavailable.');
  assert.equal(gemini.request?.input.context, 'Synthetic test only. No verified root cause, remediation, or restoration evidence is available.');
  assert.match(gemini.request?.input.systemInstruction ?? '', /Do not claim an incident is resolved/);
  assert.match(gemini.request?.input.systemInstruction ?? '', /Do not modify production/);
  assert.match(gemini.request?.input.systemInstruction ?? '', /Respect client entitlements and isolation boundaries/);
  assert.match(gemini.request?.input.systemInstruction ?? '', /Escalate security, legal, financial, data-loss/);
  assert.equal(gemini.request?.input.maxOutputTokens, 768);
  assert.equal(gemini.request?.input.temperature, 0.2);
});
