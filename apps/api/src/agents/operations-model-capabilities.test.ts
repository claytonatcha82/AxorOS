import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentRuntimeTask } from './agent-runtime-contract.js';
import { AgentRuntimeHandlerRegistry } from './agent-runtime-handlers.js';
import {
  OPERATIONS_WORKFLOW_REASONING_CAPABILITY,
  registerOperationsModelCapabilities,
} from './operations-model-capabilities.js';
import type { ExternalIntegration } from '../integrations/integration-contract.js';
import { IntegrationRegistry } from '../integrations/integration-registry.js';
import type { ModelGenerationInput, ModelGenerationOutput } from '../integrations/model-integration.js';

function task(): AgentRuntimeTask {
  return {
    taskId: 'task-operations-model-1',
    executionId: 'exec-operations-model-1',
    originAgent: 'executive_agent',
    destinationAgent: 'operations_agent',
    objective: 'Analyse a synthetic multi-agent workflow bottleneck',
    priority: 'high',
    context: { environment: 'test', dataClass: 'synthetic' },
    knowledgeReferences: ['atlas://operations/workflow-orchestration'],
    inputs: {
      workflowBrief: 'Analyse the synthetic workflow and recommend safe coordination options.',
      workflowContext: 'Synthetic test only. Sales is waiting on a dependency before Production can begin. No runtime transition or approval is granted by this prompt.',
    },
    expectedOutput: 'Workflow coordination analysis',
    dependencies: [],
    risks: [],
    confidence: 0.9,
    approvalRequired: false,
    status: 'ready',
    nextAction: 'execute_destination_capability',
    attempt: 1,
    maxAttempts: 3,
    correlationId: 'corr-operations-model-1',
    createdAt: '2026-08-15T11:07:00.000Z',
    updatedAt: '2026-08-15T11:07:00.000Z',
  };
}

test('Operations Agent registers governed workflow reasoning without runtime authority', async () => {
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
          text: 'Recommendation: keep Production blocked until the verified dependency is complete, then allow the runtime to re-evaluate readiness.',
          model: 'gemini-3.5-flash-lite',
          finishReason: 'stop',
          inputTokens: 48,
          outputTokens: 24,
        },
        evidenceReferences: ['gemini:operations-capability:synthetic'],
        retryable: false,
      };
    },
  };

  const integrations = new IntegrationRegistry();
  integrations.register(gemini);
  const handlers = new AgentRuntimeHandlerRegistry();
  registerOperationsModelCapabilities(handlers, integrations);

  const handler = handlers.get('operations_agent', OPERATIONS_WORKFLOW_REASONING_CAPABILITY);
  assert.ok(handler);

  const result = await handler.execute(task());
  assert.equal(result.status, 'completed');
  assert.equal(result.agentId, 'operations_agent');
  assert.equal(result.output.integrationId, 'model.gemini');
  assert.equal(result.output.provider, 'google-gemini');
  assert.equal(result.output.mode, 'draft');
  assert.deepEqual(result.knowledgeReferences, ['atlas://operations/workflow-orchestration']);
  assert.deepEqual(result.evidenceReferences, ['gemini:operations-capability:synthetic']);

  assert.equal(capturedInput?.prompt, 'Analyse the synthetic workflow and recommend safe coordination options.');
  assert.match(capturedInput?.context ?? '', /No runtime transition or approval is granted/);
  assert.match(capturedInput?.systemInstruction ?? '', /runtime is the sole execution authority/);
  assert.match(capturedInput?.systemInstruction ?? '', /Do not schedule, dispatch, transition, retry, cancel, escalate, approve, or complete runtime tasks/);
  assert.match(capturedInput?.systemInstruction ?? '', /Do not override Executive Agent decisions/);
  assert.match(capturedInput?.systemInstruction ?? '', /Do not trigger integrations/);
  assert.equal(capturedInput?.maxOutputTokens, 768);
  assert.equal(capturedInput?.temperature, 0.2);
});
