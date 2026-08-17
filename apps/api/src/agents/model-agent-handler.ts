import type { AgentRuntimeHandler } from './agent-runtime-handlers.js';
import type { AgentRuntimeTask, CoreAgentId } from './agent-runtime-contract.js';
import { assertProductionFinanceGate } from './production-finance-gate.js';
import type { IntegrationMode } from '../integrations/integration-contract.js';
import type { IntegrationRegistry } from '../integrations/integration-registry.js';
import type { ModelGenerationInput, ModelGenerationOutput } from '../integrations/model-integration.js';

export interface ModelAgentHandlerOptions {
  agentId: CoreAgentId;
  capabilityId: string;
  integrationId: string;
  mode?: Extract<IntegrationMode, 'sandbox' | 'draft'>;
  promptInputKey?: string;
  contextInputKey?: string;
  systemInstruction?: string;
  maxOutputTokens?: number;
  temperature?: number;
}

function requiredStringInput(task: AgentRuntimeTask, key: string): string {
  const value = task.inputs[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`runtime model handler requires string input ${key}.`);
  }
  return value.trim();
}

function optionalStringInput(task: AgentRuntimeTask, key: string | undefined): string | undefined {
  if (!key) return undefined;
  const value = task.inputs[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new Error(`runtime model handler input ${key} must be a string.`);
  const trimmed = value.trim();
  return trimmed || undefined;
}

export function createModelAgentRuntimeHandler(
  registry: IntegrationRegistry,
  options: ModelAgentHandlerOptions,
): AgentRuntimeHandler {
  if (!options.capabilityId.trim()) throw new Error('model agent handler capabilityId is required.');
  if (!options.integrationId.trim()) throw new Error('model agent handler integrationId is required.');

  const mode = options.mode ?? 'sandbox';
  const promptInputKey = options.promptInputKey ?? 'prompt';

  return {
    agentId: options.agentId,
    capabilityId: options.capabilityId,

    async execute(task) {
      if (task.destinationAgent !== options.agentId) {
        throw new Error(`model handler destination mismatch: expected ${options.agentId}, received ${task.destinationAgent}.`);
      }

      // Production execution is commercially gated. Model generation is still execution
      // because it can create client-delivery work, so clearance is enforced before any
      // provider call rather than relying only on orchestration callers to remember the gate.
      if (options.agentId === 'production_agent') assertProductionFinanceGate(task);

      const input: ModelGenerationInput = {
        prompt: requiredStringInput(task, promptInputKey),
      };
      const context = optionalStringInput(task, options.contextInputKey);
      if (context) input.context = context;
      if (options.systemInstruction) input.systemInstruction = options.systemInstruction;
      if (options.maxOutputTokens !== undefined) input.maxOutputTokens = options.maxOutputTokens;
      if (options.temperature !== undefined) input.temperature = options.temperature;

      const response = await registry.execute<ModelGenerationInput, ModelGenerationOutput>({
        integrationId: options.integrationId,
        operation: 'generate_text',
        requestedBy: options.agentId,
        executionId: task.executionId,
        correlationId: task.correlationId,
        mode,
        risk: 'low',
        input,
      });

      if (response.status === 'blocked' || response.status === 'failed') {
        throw new Error(`model integration ${response.integrationId} returned ${response.status}.`);
      }

      return {
        executionId: task.executionId,
        taskId: task.taskId,
        agentId: options.agentId,
        status: 'completed',
        output: {
          text: response.output.text,
          model: response.output.model,
          finishReason: response.output.finishReason,
          integrationId: response.integrationId,
          provider: response.provider,
          mode: response.mode,
          integrationStatus: response.status,
        },
        evidenceReferences: response.evidenceReferences,
        knowledgeReferences: task.knowledgeReferences,
        confidence: 1,
      };
    },
  };
}
