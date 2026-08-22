import assert from 'node:assert/strict';
import test from 'node:test';
import { createAnthropicModelIntegration } from './anthropic-model-integration.js';

test('Anthropic model integration sends governed draft request and preserves provider evidence', async () => {
  let requestBody: Record<string, unknown> | undefined;
  let requestHeaders: HeadersInit | undefined;
  const integration = createAnthropicModelIntegration({
    apiKey: 'anthropic-test-key',
    model: 'claude-test-model',
    fetchImpl: async (_url, init) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      requestHeaders = init?.headers;
      return new Response(JSON.stringify({
        id: 'msg_test_1',
        type: 'message',
        model: 'claude-test-model',
        content: [{ type: 'text', text: 'Governed Production draft.' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 21, output_tokens: 8 },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });

  const result = await integration.execute({
    integrationId: 'model.anthropic',
    operation: 'generate_text',
    requestedBy: 'production_agent',
    executionId: 'exec-anthropic-test-1',
    correlationId: 'corr-anthropic-test-1',
    mode: 'draft',
    risk: 'low',
    input: {
      prompt: 'Draft implementation.',
      context: 'Approved project context.',
      systemInstruction: 'Remain in draft mode.',
      maxOutputTokens: 500,
      temperature: 0.2,
    },
  });

  assert.equal(result.status, 'drafted');
  assert.equal(result.provider, 'anthropic');
  assert.equal(result.output.text, 'Governed Production draft.');
  assert.equal(result.output.model, 'claude-test-model');
  assert.equal(result.output.inputTokens, 21);
  assert.equal(result.output.outputTokens, 8);
  assert.equal(result.externalReference, 'msg_test_1');
  assert.deepEqual(result.evidenceReferences, ['anthropic:model:claude-test-model:exec-anthropic-test-1']);
  assert.equal(requestBody?.model, 'claude-test-model');
  assert.equal(requestBody?.max_tokens, 500);
  assert.equal(requestBody?.system, 'Remain in draft mode.');
  assert.equal(requestBody?.temperature, 0.2);
  assert.deepEqual(requestBody?.messages, [{ role: 'user', content: 'Context:\nApproved project context.\n\nDraft implementation.' }]);
  assert.equal((requestHeaders as Record<string, string>)['anthropic-version'], '2023-06-01');
  assert.equal((requestHeaders as Record<string, string>)['x-api-key'], 'anthropic-test-key');
});

test('Anthropic model integration maps max_tokens and transport failure safely', async () => {
  const lengthLimited = createAnthropicModelIntegration({
    apiKey: 'key',
    model: 'claude-test-model',
    fetchImpl: async () => new Response(JSON.stringify({
      id: 'msg_test_2', model: 'claude-test-model', content: [{ type: 'text', text: 'partial' }], stop_reason: 'max_tokens', usage: {},
    }), { status: 200, headers: { 'content-type': 'application/json' } }),
  });
  const baseRequest = {
    integrationId: 'model.anthropic', operation: 'generate_text', requestedBy: 'production_agent' as const,
    executionId: 'exec-2', correlationId: 'corr-2', mode: 'draft' as const, risk: 'low' as const,
    input: { prompt: 'Draft.' },
  };
  const lengthResult = await lengthLimited.execute(baseRequest);
  assert.equal(lengthResult.output.finishReason, 'length');

  const failing = createAnthropicModelIntegration({ apiKey: 'key', model: 'claude-test-model', fetchImpl: async () => { throw new Error('network'); } });
  const failure = await failing.execute({ ...baseRequest, executionId: 'exec-3' });
  assert.equal(failure.status, 'failed');
  assert.equal(failure.retryable, true);
  assert.deepEqual(failure.evidenceReferences, ['anthropic:transport-failure:exec-3']);
});
