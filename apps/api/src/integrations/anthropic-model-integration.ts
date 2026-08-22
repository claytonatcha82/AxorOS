import type { ExternalIntegration } from './integration-contract.js';
import type { ModelGenerationInput, ModelGenerationOutput } from './model-integration.js';
import { validateModelGenerationInput } from './model-integration.js';

const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_API_VERSION = '2023-06-01';
const DEFAULT_TIMEOUT_MS = 30_000;

export interface AnthropicModelIntegrationOptions {
  apiKey: string;
  model: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

interface AnthropicMessagesResponse {
  id?: string;
  model?: string;
  type?: string;
  content?: Array<{ type?: string; text?: string }>;
  stop_reason?: string | null;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
}

function responseText(response: AnthropicMessagesResponse): string {
  return response.content
    ?.filter((item) => item.type === 'text' && typeof item.text === 'string')
    .map((item) => item.text ?? '')
    .join('')
    .trim() ?? '';
}

function mapFinishReason(reason: string | null | undefined): ModelGenerationOutput['finishReason'] {
  if (reason === 'end_turn' || reason === 'stop_sequence') return 'stop';
  if (reason === 'max_tokens') return 'length';
  if (reason === 'refusal') return 'blocked';
  return 'unknown';
}

function supportsSamplingParameters(model: string): boolean {
  return !model.toLowerCase().startsWith('claude-sonnet-5');
}

export function createAnthropicModelIntegration(
  options: AnthropicModelIntegrationOptions,
): ExternalIntegration<ModelGenerationInput, ModelGenerationOutput> {
  const apiKey = options.apiKey.trim();
  if (!apiKey) throw new Error('Anthropic API key is required.');
  const model = options.model.trim();
  if (!model) throw new Error('Anthropic model is required.');
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) throw new Error('Anthropic timeoutMs must be a positive integer.');
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    integrationId: 'model.anthropic',
    kind: 'model',
    provider: 'anthropic',
    supportedModes: ['draft'],
    supportedOperations: ['generate_text'],

    async execute(request) {
      const errors = validateModelGenerationInput(request.input);
      if (errors.length > 0) throw new Error(errors.join(' '));
      if (request.mode !== 'draft') throw new Error('Anthropic model integration currently supports draft mode only.');

      const prompt = [
        request.input.context?.trim() ? `Context:\n${request.input.context.trim()}\n\n` : '',
        request.input.prompt.trim(),
      ].join('');
      const body: Record<string, unknown> = {
        model,
        max_tokens: request.input.maxOutputTokens ?? 1024,
        messages: [{ role: 'user', content: prompt }],
      };
      if (request.input.systemInstruction?.trim()) body.system = request.input.systemInstruction.trim();
      if (request.input.temperature !== undefined && supportsSamplingParameters(model)) {
        body.temperature = request.input.temperature;
      }

      let httpResponse: Response;
      try {
        httpResponse = await fetchImpl(ANTHROPIC_MESSAGES_URL, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': ANTHROPIC_API_VERSION,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch {
        return {
          integrationId: 'model.anthropic',
          operation: request.operation,
          provider: 'anthropic',
          mode: request.mode,
          status: 'failed',
          output: { text: '', model, finishReason: 'unknown' },
          evidenceReferences: [`anthropic:transport-failure:${request.executionId}`],
          retryable: true,
        };
      }

      if (!httpResponse.ok) {
        const retryable = httpResponse.status === 408 || httpResponse.status === 429 || httpResponse.status >= 500;
        return {
          integrationId: 'model.anthropic',
          operation: request.operation,
          provider: 'anthropic',
          mode: request.mode,
          status: 'failed',
          output: { text: '', model, finishReason: 'unknown' },
          externalReference: `http:${httpResponse.status}`,
          evidenceReferences: [`anthropic:http:${httpResponse.status}:${request.executionId}`],
          retryable,
        };
      }

      const providerResponse = await httpResponse.json() as AnthropicMessagesResponse;
      const finishReason = mapFinishReason(providerResponse.stop_reason);
      const blocked = finishReason === 'blocked';
      return {
        integrationId: 'model.anthropic',
        operation: request.operation,
        provider: 'anthropic',
        mode: request.mode,
        status: blocked ? 'blocked' : 'drafted',
        output: {
          text: responseText(providerResponse),
          model: providerResponse.model?.trim() || model,
          finishReason,
          ...(providerResponse.usage?.input_tokens === undefined ? {} : { inputTokens: providerResponse.usage.input_tokens }),
          ...(providerResponse.usage?.output_tokens === undefined ? {} : { outputTokens: providerResponse.usage.output_tokens }),
        },
        ...(providerResponse.id ? { externalReference: providerResponse.id } : {}),
        evidenceReferences: [`anthropic:model:${providerResponse.model?.trim() || model}:${request.executionId}`],
        retryable: false,
      };
    },
  };
}
