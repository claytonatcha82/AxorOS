import assert from 'node:assert/strict';
import test from 'node:test';
import { AgentRuntimeHandlerRegistry } from './agent-runtime-handlers.js';
import { KNOWLEDGE_SYNTHESIS_CAPABILITY, registerKnowledgeModelCapabilities } from './knowledge-model-capabilities.js';
import type { ExternalIntegration } from '../integrations/integration-contract.js';
import { IntegrationRegistry } from '../integrations/integration-registry.js';
import type { ModelGenerationInput, ModelGenerationOutput } from '../integrations/model-integration.js';

test('Knowledge Agent registers a governed draft-only Gemini synthesis capability', async () => {
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
          text: 'The supplied governance source is authoritative for this synthetic question. [S1]',
          model: 'gemini-3.5-flash-lite',
          finishReason: 'stop',
        },
        evidenceReferences: ['gemini:knowledge-capability:synthetic'],
        retryable: false,
      };
    },
  };

  const integrations = new IntegrationRegistry();
  integrations.register(gemini);
  const handlers = new AgentRuntimeHandlerRegistry();
  registerKnowledgeModelCapabilities(handlers, integrations);

  const handler = handlers.get('knowledge_agent', KNOWLEDGE_SYNTHESIS_CAPABILITY);
  assert.ok(handler);

  const result = await handler.execute({
    taskId: 'task-knowledge-capability-1',
    executionId: 'exec-knowledge-capability-1',
    originAgent: 'operations_agent',
    destinationAgent: 'knowledge_agent',
    objective: 'Synthesize supplied retrieved knowledge',
    priority: 'normal',
    context: {},
    knowledgeReferences: ['atlas://governance/synthetic-source'],
    inputs: {
      knowledgeQuestion: 'What does the supplied source establish?',
      retrievedContext: '[S1] Title: Synthetic Governance\nPath: Atlas/Synthetic.md\nHeading: Rule\nVersion: 1\nContent: Synthetic governed rule.',
    },
    expectedOutput: 'Citation-ready synthesis',
    dependencies: [],
    risks: [],
    confidence: 0.9,
    approvalRequired: false,
    status: 'in_progress',
    nextAction: 'execute_destination_capability',
    attempt: 1,
    maxAttempts: 3,
    correlationId: 'corr-knowledge-capability-1',
    createdAt: '2026-08-15T11:21:00.000Z',
    updatedAt: '2026-08-15T11:21:00.000Z',
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.agentId, 'knowledge_agent');
  assert.equal(result.output.integrationId, 'model.gemini');
  assert.equal(result.output.mode, 'draft');
  assert.match(capturedInput?.systemInstruction ?? '', /deterministic retrieval remains authoritative/);
  assert.match(capturedInput?.systemInstruction ?? '', /Do not invent sources, citations/);
  assert.match(capturedInput?.systemInstruction ?? '', /Governance over Standards over SOPs/);
  assert.match(capturedInput?.systemInstruction ?? '', /do not silently fill gaps/);
  assert.match(capturedInput?.systemInstruction ?? '', /follow-up retrieval/);
  assert.match(capturedInput?.context ?? '', /\[S1\]/);
});
