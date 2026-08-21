import type { ExternalIntegration } from './integration-contract.js';
import type { ModelGenerationInput, ModelGenerationOutput } from './model-integration.js';
import { validateModelGenerationInput } from './model-integration.js';

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';
const DEFAULT_OPENAI_MODEL = 'gpt-5.6-terra';
const DEFAULT_TIMEOUT_MS = 30_000;

export interface OpenAIModelIntegrationOptions {
  apiKey: string;
  model?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

interface OpenAIResponsesResponse {
  id?: string;
  model?: string;
  status?: 'completed' | 'failed' | 'in_progress' | 'cancelled' | 'queued' | 'incomplete';
  incomplete_details?: { reason?: string } | null;
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string }>;
  }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
  error?: { code?: string; message?: string } | null;
}

function responseText(response: OpenAIResponsesResponse): string {
  return response.output
    ?.flatMap((item) => item.content ?? [])
    .filter((item) => item.type === 'output_text' && typeof item.text === 'string')
    .map((item) => item.text ?? '')
    .join('')
    .trim() ?? '';
}

function finishReason(response: OpenAIResponsesResponse): ModelGenerationOutput['finishReason'] {
  if (response.status === 'completed') return 'stop';
  if (response.status === 'incomplete' && response.incomplete_details?.reason === 'max_output_tokens') return 'length';
  return 'unknown';
}

export function createOpenAIModelIntegration(
  options: OpenAIModelIntegrationOptions,
): ExternalIntegration<ModelGenerationInput, ModelGenerationOutput> {
  const apiKey = options.apiKey.trim();
  if (!apiKey) throw new Error('OpenAI API key is required.');

  const model = options.model?.trim() || DEFAULT_OPENAI_MODEL;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) throw new Error('OpenAI timeoutMs must be a positive integer.');
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    integrationId: 'model.openai',
    kind: 'model',
    provider: 'openai',
    supportedModes: ['draft'],
    supportedOperations: ['generate_text'],

    async execute(request) {
      const errors = validateModelGenerationInput(request.input);
      if (errors.length > 0) throw new Error(errors.join(' '));
      if (request.mode !== 'draft') throw new Error('OpenAI model integration currently supports draft mode only.');

      const input = [
        request.input.context?.trim() ? `Context:\n${request.input.context.trim()}\n\n` : '',
        request.input.prompt.trim(),
      ].join('');

      const body: Record<string, unknown> = {
        model,
        input,
        store: false,
      };
      if (request.input.systemInstruction?.trim()) body.instructions = request.input.systemInstruction.trim();
      if (request.input.maxOutputTokens !== undefined) body.max_output_tokens = request.input.maxOutputTokens;
      if (request.input.temperature !== undefined) body.temperature = request.input.temperature;

      let httpResponse: Response;
      try {
        httpResponse = await fetchImpl(OPENAI_RESPONSES_URL, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${apiKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch {
        return {
          integrationId: 'model.openai',
          operation: request.operation,
          provider: 'openai',
          mode: request.mode,
          status: 'failed',
          output: { text: '', model, finishReason: 'unknown' },
          evidenceReferences: [`openai:transport-failure:${request.executionId}`],
          retryable: true,
        };
      }

      if (!httpResponse.ok) {
        const retryable = httpResponse.status === 408 || httpResponse.status === 429 || httpResponse.status >= 500;
        return {
          integrationId: 'model.openai',
          operation: request.operation,
          provider: 'openai',
          mode: request.mode,
          status: 'failed',
          output: { text: '', model, finishReason: 'unknown' },
          externalReference: `http:${httpResponse.status}`,
          evidenceReferences: [`openai:http:${httpResponse.status}:${request.executionId}`],
          retryable,
        };
      }

      const providerResponse = await httpResponse.json() as OpenAIResponsesResponse;
      const text = responseText(providerResponse);
      const reason = finishReason(providerResponse);
      const completed = providerResponse.status === 'completed';

      return {
        integrationId: 'model.openai',
        operation: request.operation,
        provider: 'openai',
        mode: request.mode,
        status: completed ? 'drafted' : 'failed',
        output: {
          text,
          model: providerResponse.model?.trim() || model,
          finishReason: reason,
          ...(providerResponse.usage?.input_tokens === undefined ? {} : { inputTokens: providerResponse.usage.input_tokens }),
          ...(providerResponse.usage?.output_tokens === undefined ? {} : { outputTokens: providerResponse.usage.output_tokens }),
        },
        ...(providerResponse.id ? { externalReference: providerResponse.id } : {}),
        evidenceReferences: [`openai:model:${providerResponse.model?.trim() || model}:${request.executionId}`],
        retryable: false,
      };
    },
  };
}
