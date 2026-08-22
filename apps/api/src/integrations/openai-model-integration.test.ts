import test from 'node:test';
import assert from 'node:assert/strict';
import type { IntegrationRequest } from './integration-contract.js';
import type { ModelGenerationInput } from './model-integration.js';
import { createOpenAIModelIntegration } from './openai-model-integration.js';

function request(): IntegrationRequest<ModelGenerationInput> {
  return {
    integrationId: 'model.openai',
    requestedBy: 'sales_agent',
    executionId: 'sales-openai-test-1',
    correlationId: 'lead-1',
    operation: 'generate_text',
    mode: 'draft',
    risk: 'medium',
    input: {
      systemInstruction: 'Stay within Sales governance.',
      context: 'Prospect asked for more information.',
      prompt: 'Prepare a bounded classification.',
      maxOutputTokens: 500,
    },
  };
}

test('uses the OpenAI Responses API with GPT-5.6 Terra by default', async () => {
  let capturedUrl = '';
  let capturedInit: RequestInit | undefined;
  const integration = createOpenAIModelIntegration({
    apiKey: 'test-openai-key',
    fetchImpl: async (url, init) => {
      capturedUrl = String(url);
      capturedInit = init;
      return new Response(JSON.stringify({
        id: 'resp_1',
        model: 'gpt-5.6-terra',
        status: 'completed',
        output: [{ type: 'message', content: [{ type: 'output_text', text: '{"primaryCategory":"positive_interest"}' }] }],
        usage: { input_tokens: 42, output_tokens: 12 },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });

  const result = await integration.execute(request());
  assert.equal(capturedUrl, 'https://api.openai.com/v1/responses');
  assert.equal(capturedInit?.method, 'POST');
  assert.equal((capturedInit?.headers as Record<string, string>).authorization, 'Bearer test-openai-key');
  const body = JSON.parse(String(capturedInit?.body));
  assert.equal(body.model, 'gpt-5.6-terra');
  assert.equal(body.instructions, 'Stay within Sales governance.');
  assert.match(body.input, /Prospect asked for more information/);
  assert.equal(body.max_output_tokens, 500);
  assert.equal(body.store, false);
  assert.equal(result.integrationId, 'model.openai');
  assert.equal(result.provider, 'openai');
  assert.equal(result.status, 'drafted');
  assert.equal(result.output?.model, 'gpt-5.6-terra');
  assert.equal(result.output?.finishReason, 'stop');
  assert.equal(result.output?.inputTokens, 42);
  assert.equal(result.output?.outputTokens, 12);
  assert.equal(result.externalReference, 'resp_1');
});

test('supports an explicitly configured OpenAI model without changing the integration contract', async () => {
  const integration = createOpenAIModelIntegration({
    apiKey: 'test-openai-key',
    model: 'gpt-5.6-luna',
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      assert.equal(body.model, 'gpt-5.6-luna');
      return new Response(JSON.stringify({
        id: 'resp_2', model: 'gpt-5.6-luna', status: 'completed',
        output: [{ type: 'message', content: [{ type: 'output_text', text: 'draft' }] }],
      }), { status: 200 });
    },
  });
  const result = await integration.execute(request());
  assert.equal(result.output?.model, 'gpt-5.6-luna');
});

test('fails closed on OpenAI transport failure', async () => {
  const integration = createOpenAIModelIntegration({
    apiKey: 'test-openai-key',
    fetchImpl: async () => { throw new Error('network failure'); },
  });
  const result = await integration.execute(request());
  assert.equal(result.status, 'failed');
  assert.equal(result.retryable, true);
  assert.equal(result.output?.text, '');
});

test('marks retryable OpenAI HTTP failures without producing model output', async () => {
  const integration = createOpenAIModelIntegration({
    apiKey: 'test-openai-key',
    fetchImpl: async () => new Response('rate limited', { status: 429 }),
  });
  const result = await integration.execute(request());
  assert.equal(result.status, 'failed');
  assert.equal(result.retryable, true);
  assert.equal(result.externalReference, 'http:429');
});

test('requires an OpenAI API key', () => {
  assert.throws(() => createOpenAIModelIntegration({ apiKey: '   ' }), /OpenAI API key/);
});
