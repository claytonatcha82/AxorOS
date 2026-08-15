import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentRuntimeTask } from './agent-runtime-contract.js';
import { AgentRuntimeHandlerRegistry } from './agent-runtime-handlers.js';
import { SALES_DRAFT_RESPONSE_CAPABILITY, registerSalesModelCapabilities } from './sales-model-capabilities.js';
import type { ExternalIntegration } from '../integrations/integration-contract.js';
import { IntegrationRegistry } from '../integrations/integration-registry.js';
import type { ModelGenerationInput, ModelGenerationOutput } from '../integrations/model-integration.js';

function task(): AgentRuntimeTask {
  return {
    taskId: 'task-sales-gemini-1',
    executionId: 'execution-sales-gemini-1',
    originAgent: 'operations_agent',
    destinationAgent: 'sales_agent',
    objective: 'Draft a governed sales response from approved inputs',
    priority: 'normal',
    context: { environment: 'test', dataClass: 'synthetic' },
    knowledgeReferences: ['atlas://sales/synthetic-opportunity'],
    inputs: {
      salesBrief: 'Draft a concise response explaining the proposed website package without inventing any commercial terms.',
      salesContext: 'Synthetic prospect. Approved scope: five-page brochure website. No approved price, discount, payment term, or delivery date is supplied.',
    },
    expectedOutput: 'Draft sales response with missing commercial information identified',
    dependencies: [],
    risks: [],
    confidence: 1,
    approvalRequired: false,
    status: 'in_progress',
    nextAction: 'execute_destination_capability',
    attempt: 1,
    maxAttempts: 3,
    correlationId: 'correlation-sales-gemini-1',
    createdAt: '2026-08-15T10:50:00.000Z',
    updatedAt: '2026-08-15T10:50:00.000Z',
  };
}

test('Sales Agent draft capability uses Gemini with commercial authority boundaries', async () => {
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
          text: 'Draft sales response. Approved pricing and delivery timing are still required before a complete commercial proposal can be prepared.',
          model: 'gemini-3.5-flash-lite',
          finishReason: 'stop',
        },
        evidenceReferences: ['gemini:test:sales'],
        retryable: false,
      };
    },
  };

  const integrations = new IntegrationRegistry();
  integrations.register(gemini);
  const handlers = new AgentRuntimeHandlerRegistry();
  registerSalesModelCapabilities(handlers, integrations);

  const handler = handlers.require('sales_agent', SALES_DRAFT_RESPONSE_CAPABILITY);
  const result = await handler.execute(task());

  assert.equal(result.status, 'completed');
  assert.equal(result.agentId, 'sales_agent');
  assert.equal(result.output.provider, 'google-gemini');
  assert.equal(result.output.mode, 'draft');
  assert.equal(result.output.integrationStatus, 'drafted');
  assert.deepEqual(result.knowledgeReferences, ['atlas://sales/synthetic-opportunity']);

  const request = captured as { requestedBy: string; mode: string; risk: string; input: ModelGenerationInput };
  assert.equal(request.requestedBy, 'sales_agent');
  assert.equal(request.mode, 'draft');
  assert.equal(request.risk, 'low');
  assert.equal(request.input.prompt, 'Draft a concise response explaining the proposed website package without inventing any commercial terms.');
  assert.equal(request.input.context, 'Synthetic prospect. Approved scope: five-page brochure website. No approved price, discount, payment term, or delivery date is supplied.');
  assert.match(request.input.systemInstruction ?? '', /Do not invent prices, discounts, payment terms/);
  assert.match(request.input.systemInstruction ?? '', /Do not send email, messages, proposals, contracts, invoices, payment links/);
  assert.match(request.input.systemInstruction ?? '', /Do not claim that a contract is signed, a deposit is paid, payment is confirmed, or funds are settled/);
  assert.equal(request.input.maxOutputTokens, 768);
  assert.equal(request.input.temperature, 0.3);
});
