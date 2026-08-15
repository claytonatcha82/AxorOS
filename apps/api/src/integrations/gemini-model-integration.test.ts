import assert from 'node:assert/strict';
import test from 'node:test';
import { createGeminiModelIntegration } from './gemini-model-integration.js';

function request() {
  return {
    integrationId: 'model.gemini',
    operation: 'generate_text',
    requestedBy: 'marketing_agent' as const,
    executionId: 'exec-gemini-1',
    correlationId: 'corr-gemini-1',
    mode: 'draft' as const,
    risk: 'low' as const,
    input: {
      prompt: 'Draft a concise homepage headline.',
      systemInstruction: 'Write professional agency copy.',
      context: 'AxorOS serves businesses in South Africa and abroad.',
      maxOutputTokens: 200,
    },
  };
}

test('Gemini adapter sends governed draft request and normalizes successful output', async () => {
  let capturedUrl = '';
  let capturedInit: RequestInit | undefined;
  const fetchImpl: typeof fetch = async (input, init) => {
    capturedUrl = String(input);
    capturedInit = init;
    return new Response(JSON.stringify({
      candidates: [{
        content: { parts: [{ text: 'Premium websites built for growth.' }] },
        finishReason: 'STOP',
      }],
      usageMetadata: {
        promptTokenCount: 42,
        candidatesTokenCount: 8,
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  const integration = createGeminiModelIntegration({
    apiKey: 'test-api-key',
    fetchImpl,
  });
  const result = await integration.execute(request());

  assert.match(capturedUrl, /gemini-3\.5-flash-lite:generateContent$/);
  const headers = new Headers(capturedInit?.headers);
  assert.equal(headers.get('x-goog-api-key'), 'test-api-key');
  assert.equal(capturedInit?.method, 'POST');

  const body = JSON.parse(String(capturedInit?.body)) as Record<string, unknown>;
  assert.ok(body.systemInstruction);
  assert.ok(body.contents);
  assert.deepEqual(body.generationConfig, { maxOutputTokens: 200 });

  assert.equal(result.status, 'drafted');
  assert.equal(result.provider, 'google-gemini');
  assert.equal(result.output.text, 'Premium websites built for growth.');
  assert.equal(result.output.model, 'gemini-3.5-flash-lite');
  assert.equal(result.output.finishReason, 'stop');
  assert.equal(result.output.inputTokens, 42);
  assert.equal(result.output.outputTokens, 8);
  assert.equal(result.retryable, false);
});

test('Gemini adapter normalizes rate limiting as retryable failure', async () => {
  const fetchImpl: typeof fetch = async () => new Response('{}', { status: 429 });
  const integration = createGeminiModelIntegration({ apiKey: 'test-api-key', fetchImpl });

  const result = await integration.execute(request());

  assert.equal(result.status, 'failed');
  assert.equal(result.retryable, true);
  assert.equal(result.externalReference, 'http:429');
});

test('Gemini adapter normalizes provider safety blocks without retrying', async () => {
  const fetchImpl: typeof fetch = async () => new Response(JSON.stringify({
    promptFeedback: { blockReason: 'SAFETY' },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
  const integration = createGeminiModelIntegration({ apiKey: 'test-api-key', fetchImpl });

  const result = await integration.execute(request());

  assert.equal(result.status, 'blocked');
  assert.equal(result.output.finishReason, 'blocked');
  assert.equal(result.retryable, false);
});

test('Gemini adapter does not allow sandbox or live provider execution', async () => {
  const integration = createGeminiModelIntegration({
    apiKey: 'test-api-key',
    fetchImpl: async () => new Response('{}', { status: 200 }),
  });

  await assert.rejects(
    () => integration.execute({ ...request(), mode: 'sandbox' }),
    /draft mode only/,
  );
});
