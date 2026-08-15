import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentRuntimeTask } from './agent-runtime-contract.js';
import { AgentRuntimeHandlerRegistry } from './agent-runtime-handlers.js';
import { LEAD_RESEARCH_QUALIFICATION_CAPABILITY, registerLeadModelCapabilities } from './lead-model-capabilities.js';
import { IntegrationRegistry } from '../integrations/integration-registry.js';
import type { ExternalIntegration } from '../integrations/integration-contract.js';
import type { ModelGenerationInput, ModelGenerationOutput } from '../integrations/model-integration.js';

function task(): AgentRuntimeTask {
  return {
    taskId: 'task-lead-gemini-1',
    executionId: 'execution-lead-gemini-1',
    originAgent: 'operations_agent',
    destinationAgent: 'lead_agent',
    objective: 'Research and qualify a synthetic lead',
    priority: 'normal',
    context: { source: 'synthetic_test' },
    knowledgeReferences: ['atlas://lead/qualification-policy'],
    inputs: {
      researchBrief: 'Assess whether the supplied fictional company appears suitable for a website redesign opportunity.',
      leadContext: 'Synthetic company: Example Engineering. Existing website is described as outdated. No budget, contact person, or purchase intent is known.',
    },
    expectedOutput: 'Internal qualification assessment',
    dependencies: [],
    risks: [],
    confidence: 0.8,
    approvalRequired: false,
    status: 'in_progress',
    nextAction: 'execute_destination_capability',
    attempt: 1,
    maxAttempts: 3,
    correlationId: 'correlation-lead-gemini-1',
    createdAt: '2026-08-15T10:20:00.000Z',
    updatedAt: '2026-08-15T10:20:00.000Z',
  };
}

test('Lead Agent research capability uses Gemini in governed draft mode without outreach authority', async () => {
  let captured: unknown;
  const gemini: ExternalIntegration<ModelGenerationInput, ModelGenerationOutput> = {
    integrationId: 'model.gemini',
    kind: 'model',
    provider: 'google-gemini',
    supportedModes: ['draft'],
    supportedOperations: ['generate_text'],
    async execute(request) {
      captured = request;
      return {
        integrationId: 'model.gemini',
        operation: request.operation,
        provider: 'google-gemini',
        mode: request.mode,
        status: 'drafted',
        output: {
          text: 'Potential fit based on the supplied website signal; budget, authority, and intent remain unknown.',
          model: 'gemini-3.5-flash-lite',
          finishReason: 'stop',
        },
        evidenceReferences: ['gemini:test:lead'],
        retryable: false,
      };
    },
  };

  const integrations = new IntegrationRegistry();
  integrations.register(gemini);
  const handlers = new AgentRuntimeHandlerRegistry();
  registerLeadModelCapabilities(handlers, integrations);

  const handler = handlers.require('lead_agent', LEAD_RESEARCH_QUALIFICATION_CAPABILITY);
  const result = await handler.execute(task());

  assert.equal(result.status, 'completed');
  assert.equal(result.output.provider, 'google-gemini');
  assert.equal(result.output.mode, 'draft');
  assert.equal(result.output.integrationStatus, 'drafted');
  assert.deepEqual(result.knowledgeReferences, ['atlas://lead/qualification-policy']);

  const request = captured as { requestedBy: string; mode: string; risk: string; input: ModelGenerationInput };
  assert.equal(request.requestedBy, 'lead_agent');
  assert.equal(request.mode, 'draft');
  assert.equal(request.risk, 'low');
  assert.equal(request.input.prompt, 'Assess whether the supplied fictional company appears suitable for a website redesign opportunity.');
  assert.match(request.input.systemInstruction ?? '', /Do not write or send outreach/);
  assert.match(request.input.systemInstruction ?? '', /Do not invent company facts/);
  assert.equal(request.input.maxOutputTokens, 640);
  assert.equal(request.input.temperature, 0.2);
});
