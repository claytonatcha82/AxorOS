import type { ExternalIntegration } from './integration-contract.js';
import type { ModelGenerationInput, ModelGenerationOutput, ModelGenerationRequest, ModelGenerationResponse } from './model-integration.js';
import { validateModelGenerationInput } from './model-integration.js';

export interface SandboxModelIntegrationOptions {
  integrationId?: string;
  model?: string;
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function createSandboxModelIntegration(
  options: SandboxModelIntegrationOptions = {},
): ExternalIntegration<ModelGenerationInput, ModelGenerationOutput> {
  const integrationId = options.integrationId ?? 'model.sandbox';
  const model = options.model ?? 'axoros-sandbox-model-v1';

  return {
    integrationId,
    kind: 'model',
    provider: 'axoros-sandbox',
    supportedModes: ['sandbox', 'draft'],
    supportedOperations: ['generate_text'],

    async execute(request: ModelGenerationRequest): Promise<ModelGenerationResponse> {
      const errors = validateModelGenerationInput(request.input);
      if (errors.length) throw new Error(errors.join(' '));

      const prompt = normalizeText(request.input.prompt);
      const context = request.input.context ? normalizeText(request.input.context) : undefined;
      const systemInstruction = request.input.systemInstruction
        ? normalizeText(request.input.systemInstruction)
        : undefined;

      const parts = [
        '[SANDBOX MODEL OUTPUT]',
        systemInstruction ? `Instruction: ${systemInstruction}` : undefined,
        context ? `Context: ${context}` : undefined,
        `Prompt: ${prompt}`,
      ].filter((value): value is string => Boolean(value));

      return {
        integrationId,
        operation: request.operation,
        provider: 'axoros-sandbox',
        mode: request.mode,
        status: request.mode === 'draft' ? 'drafted' : 'succeeded',
        output: {
          text: parts.join('\n'),
          model,
          finishReason: 'stop',
        },
        evidenceReferences: [],
        retryable: false,
      };
    },
  };
}
