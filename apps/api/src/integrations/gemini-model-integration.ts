import type { ExternalIntegration } from './integration-contract.js';
import type { ModelGenerationInput, ModelGenerationOutput } from './model-integration.js';
import { validateModelGenerationInput } from './model-integration.js';

const GEMINI_API_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash-lite';
const DEFAULT_TIMEOUT_MS = 30_000;

export interface GeminiModelIntegrationOptions {
  apiKey: string;
  model?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

interface GeminiGenerateContentResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
    finishReason?: string;
  }>;
  promptFeedback?: {
    blockReason?: string;
  };
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
  };
}

function mapFinishReason(reason: string | undefined, promptBlocked: boolean): ModelGenerationOutput['finishReason'] {
  if (promptBlocked) return 'blocked';
  if (reason === 'STOP') return 'stop';
  if (reason === 'MAX_TOKENS') return 'length';
  if (reason === 'SAFETY' || reason === 'BLOCKLIST' || reason === 'PROHIBITED_CONTENT' || reason === 'SPII' || reason === 'IMAGE_SAFETY') {
    return 'blocked';
  }
  return 'unknown';
}

function responseText(response: GeminiGenerateContentResponse): string {
  return response.candidates?.[0]?.content?.parts
    ?.map((part) => part.text ?? '')
    .join('')
    .trim() ?? '';
}

export function createGeminiModelIntegration(options: GeminiModelIntegrationOptions): ExternalIntegration<ModelGenerationInput, ModelGenerationOutput> {
  const apiKey = options.apiKey.trim();
  if (!apiKey) throw new Error('Gemini API key is required.');

  const model = options.model?.trim() || DEFAULT_GEMINI_MODEL;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) throw new Error('Gemini timeoutMs must be a positive integer.');

  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    integrationId: 'model.gemini',
    kind: 'model',
    provider: 'google-gemini',
    supportedModes: ['draft'],
    supportedOperations: ['generate_text'],

    async execute(request) {
      const errors = validateModelGenerationInput(request.input);
      if (errors.length > 0) throw new Error(errors.join(' '));
      if (request.mode !== 'draft') throw new Error('Gemini model integration currently supports draft mode only.');

      const userParts: Array<{ text: string }> = [];
      if (request.input.context?.trim()) userParts.push({ text: `Context:\n${request.input.context.trim()}\n\n` });
      userParts.push({ text: request.input.prompt.trim() });

      const generationConfig: Record<string, number> = {};
      if (request.input.maxOutputTokens !== undefined) generationConfig.maxOutputTokens = request.input.maxOutputTokens;

      const body: Record<string, unknown> = {
        contents: [{ role: 'user', parts: userParts }],
      };
      if (request.input.systemInstruction?.trim()) {
        body.systemInstruction = { parts: [{ text: request.input.systemInstruction.trim() }] };
      }
      if (Object.keys(generationConfig).length > 0) body.generationConfig = generationConfig;

      let httpResponse: Response;
      try {
        httpResponse = await fetchImpl(`${GEMINI_API_BASE_URL}/models/${encodeURIComponent(model)}:generateContent`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-goog-api-key': apiKey,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch {
        return {
          integrationId: 'model.gemini',
          operation: request.operation,
          provider: 'google-gemini',
          mode: request.mode,
          status: 'failed',
          output: { text: '', model, finishReason: 'unknown' },
          evidenceReferences: [`gemini:transport-failure:${request.executionId}`],
          retryable: true,
        };
      }

      if (!httpResponse.ok) {
        const retryable = httpResponse.status === 408 || httpResponse.status === 429 || httpResponse.status >= 500;
        return {
          integrationId: 'model.gemini',
          operation: request.operation,
          provider: 'google-gemini',
          mode: request.mode,
          status: 'failed',
          output: { text: '', model, finishReason: 'unknown' },
          externalReference: `http:${httpResponse.status}`,
          evidenceReferences: [`gemini:http:${httpResponse.status}:${request.executionId}`],
          retryable,
        };
      }

      const providerResponse = await httpResponse.json() as GeminiGenerateContentResponse;
      const promptBlocked = Boolean(providerResponse.promptFeedback?.blockReason);
      const finishReason = mapFinishReason(providerResponse.candidates?.[0]?.finishReason, promptBlocked);
      const text = responseText(providerResponse);
      const blocked = finishReason === 'blocked';

      return {
        integrationId: 'model.gemini',
        operation: request.operation,
        provider: 'google-gemini',
        mode: request.mode,
        status: blocked ? 'blocked' : 'drafted',
        output: {
          text,
          model,
          finishReason,
          ...(providerResponse.usageMetadata?.promptTokenCount === undefined ? {} : { inputTokens: providerResponse.usageMetadata.promptTokenCount }),
          ...(providerResponse.usageMetadata?.candidatesTokenCount === undefined ? {} : { outputTokens: providerResponse.usageMetadata.candidatesTokenCount }),
        },
        evidenceReferences: [`gemini:model:${model}:${request.executionId}`],
        retryable: false,
      };
    },
  };
}
