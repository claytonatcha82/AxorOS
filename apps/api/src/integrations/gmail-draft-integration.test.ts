import assert from 'node:assert/strict';
import test from 'node:test';
import { createGmailDraftIntegration } from './gmail-draft-integration.js';

function makeFetch() {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.toString();
    calls.push(init ? { url, init } : { url });

    if (url === 'https://oauth2.googleapis.com/token') {
      return new Response(JSON.stringify({ access_token: 'synthetic-access-token', expires_in: 3600, token_type: 'Bearer' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url === 'https://gmail.googleapis.com/gmail/v1/users/me/drafts') {
      return new Response(JSON.stringify({ id: 'draft-123', message: { id: 'msg-123', threadId: 'thread-123' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    throw new Error(`Unexpected URL: ${url}`);
  };
  return { fetchImpl, calls };
}

function request() {
  return {
    integrationId: 'email.gmail',
    operation: 'create_draft',
    requestedBy: 'sales_agent' as const,
    executionId: 'exec-gmail-draft-1',
    correlationId: 'corr-gmail-draft-1',
    mode: 'draft' as const,
    risk: 'low' as const,
    input: {
      fromIdentity: 'sales',
      to: [{ email: 'prospect@example.test', name: 'Synthetic Prospect' }],
      subject: 'Synthetic website discussion',
      textBody: 'Synthetic draft body. Do not send.',
    },
  };
}

test('creates a real Gmail mailbox draft through drafts.create only', async () => {
  const { fetchImpl, calls } = makeFetch();
  const integration = createGmailDraftIntegration({
    clientId: 'client-id',
    clientSecret: 'client-secret',
    refreshToken: 'refresh-token',
    identityAddresses: { sales: 'sales@example.test' },
    fetchImpl,
  });

  const result = await integration.execute(request());

  assert.equal(result.status, 'drafted');
  assert.equal(result.output.draftId, 'draft-123');
  assert.equal(result.output.messageId, 'msg-123');
  assert.equal(result.externalReference, 'draft-123');
  assert.deepEqual(result.evidenceReferences, ['gmail:draft:draft-123']);
  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.url, 'https://oauth2.googleapis.com/token');
  assert.equal(calls[1]?.url, 'https://gmail.googleapis.com/gmail/v1/users/me/drafts');
  assert.doesNotMatch(calls[1]?.url ?? '', /send/);

  const authHeader = new Headers(calls[1]?.init?.headers).get('Authorization');
  assert.equal(authHeader, 'Bearer synthetic-access-token');
  const body = JSON.parse(String(calls[1]?.init?.body)) as { message: { raw: string } };
  const decoded = Buffer.from(body.message.raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  assert.match(decoded, /From: sales@example\.test/);
  assert.match(decoded, /To: "Synthetic Prospect" <prospect@example\.test>/);
  assert.match(decoded, /Subject: Synthetic website discussion/);
  assert.match(decoded, /Synthetic draft body\. Do not send\./);
});

test('rejects an unconfigured sender identity before calling Gmail', async () => {
  const { fetchImpl, calls } = makeFetch();
  const integration = createGmailDraftIntegration({
    clientId: 'client-id',
    clientSecret: 'client-secret',
    refreshToken: 'refresh-token',
    identityAddresses: { support: 'support@example.test' },
    fetchImpl,
  });

  await assert.rejects(() => integration.execute(request()), /No Gmail address configured for email identity sales/);
  assert.equal(calls.length, 0);
});

test('does not expose any Gmail send operation or live mode', () => {
  const integration = createGmailDraftIntegration({
    clientId: 'client-id',
    clientSecret: 'client-secret',
    refreshToken: 'refresh-token',
    identityAddresses: { sales: 'sales@example.test' },
    fetchImpl: makeFetch().fetchImpl,
  });

  assert.deepEqual(integration.supportedModes, ['draft']);
  assert.deepEqual(integration.supportedOperations, ['create_draft']);
});
