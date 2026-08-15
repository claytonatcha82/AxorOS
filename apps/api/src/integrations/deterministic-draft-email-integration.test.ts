import assert from 'node:assert/strict';
import test from 'node:test';
import { DeterministicDraftEmailIntegration } from './deterministic-draft-email-integration.js';

function request(overrides: Record<string, unknown> = {}) {
  return {
    integrationId: 'email.draft',
    operation: 'create_draft',
    requestedBy: 'sales_agent' as const,
    executionId: 'exec-email-draft-1',
    correlationId: 'corr-email-draft-1',
    mode: 'draft' as const,
    risk: 'low' as const,
    input: {
      fromIdentity: 'sales',
      to: [{ email: 'prospect@example.test', name: 'Synthetic Prospect' }],
      subject: 'Synthetic website discussion',
      textBody: 'This is a synthetic draft and must not be sent.',
    },
    ...overrides,
  };
}

test('creates an internal email draft without sending', async () => {
  const integration = new DeterministicDraftEmailIntegration();
  const result = await integration.execute(request());

  assert.equal(result.status, 'drafted');
  assert.equal(result.mode, 'draft');
  assert.equal(result.output.fromIdentity, 'sales');
  assert.deepEqual(result.output.recipients, ['prospect@example.test']);
  assert.equal(result.externalReference, undefined);
});

test('blocks send_email operation', async () => {
  const integration = new DeterministicDraftEmailIntegration();
  const result = await integration.execute(request({ operation: 'send_email' }));

  assert.equal(result.status, 'blocked');
  assert.match(result.output.preview, /cannot send email/i);
});

test('blocks live mode even when requested directly', async () => {
  const integration = new DeterministicDraftEmailIntegration();
  const result = await integration.execute(request({ mode: 'live' }));

  assert.equal(result.status, 'blocked');
  assert.match(result.output.preview, /only supports draft mode/i);
});
