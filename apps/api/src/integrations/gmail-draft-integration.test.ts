import assert from 'node:assert/strict';
import test from 'node:test';
import { createGmailDraftIntegration } from './gmail-draft-integration.js';

function encoded(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

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

    if (url === 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send') {
      return new Response(JSON.stringify({ id: 'sent-123', threadId: 'thread-123' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url === 'https://gmail.googleapis.com/gmail/v1/users/me/threads/thread-123?format=full') {
      return new Response(JSON.stringify({
        id: 'thread-123',
        messages: [
          {
            id: 'sent-123',
            threadId: 'thread-123',
            internalDate: '1787250000000',
            snippet: 'Synthetic approved supervised message.',
            payload: {
              mimeType: 'text/plain',
              headers: [
                { name: 'From', value: 'sales@example.test' },
                { name: 'To', value: 'prospect@example.test' },
                { name: 'Subject', value: 'Synthetic website discussion' },
              ],
              body: { data: encoded('Synthetic approved supervised message.') },
            },
          },
          {
            id: 'reply-456',
            threadId: 'thread-123',
            internalDate: '1787250300000',
            snippet: 'Thanks, please send more information.',
            payload: {
              mimeType: 'multipart/alternative',
              headers: [
                { name: 'From', value: 'Prospect <prospect@example.test>' },
                { name: 'To', value: 'sales@example.test' },
                { name: 'Subject', value: 'Re: Synthetic website discussion' },
              ],
              parts: [
                {
                  mimeType: 'text/plain',
                  body: { data: encoded('Thanks, please send more information.') },
                },
                {
                  mimeType: 'text/html',
                  body: { data: encoded('<p>Thanks, please send more information.</p>') },
                },
              ],
            },
          },
        ],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url === 'https://gmail.googleapis.com/gmail/v1/users/me/threads/thread-bounce?format=full') {
      return new Response(JSON.stringify({
        id: 'thread-bounce',
        messages: [
          {
            id: 'sent-bounce',
            threadId: 'thread-bounce',
            internalDate: '1787250000000',
            payload: {
              mimeType: 'text/plain',
              headers: [
                { name: 'From', value: 'sales@example.test' },
                { name: 'To', value: 'missing@example.test' },
                { name: 'Subject', value: 'Synthetic website discussion' },
              ],
              body: { data: encoded('Synthetic approved supervised message.') },
            },
          },
          {
            id: 'dsn-789',
            threadId: 'thread-bounce',
            internalDate: '1787250300000',
            snippet: 'Delivery failed: address not found.',
            payload: {
              mimeType: 'multipart/report',
              headers: [
                { name: 'From', value: 'Mail Delivery Subsystem <mailer-daemon@example.test>' },
                { name: 'To', value: 'sales@example.test' },
                { name: 'Subject', value: 'Delivery Status Notification (Failure)' },
              ],
              parts: [
                {
                  mimeType: 'text/plain',
                  body: { data: encoded('Delivery failed: address not found.') },
                },
                {
                  mimeType: 'message/delivery-status',
                  body: { data: encoded('Action: failed\nStatus: 5.1.1') },
                },
              ],
            },
          },
        ],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    throw new Error(`Unexpected URL: ${url}`);
  };
  return { fetchImpl, calls };
}

function draftRequest() {
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

function sendRequest() {
  return {
    integrationId: 'email.gmail',
    operation: 'send_email',
    requestedBy: 'sales_agent' as const,
    executionId: 'exec-gmail-send-1',
    correlationId: 'corr-gmail-send-1',
    mode: 'live' as const,
    risk: 'high' as const,
    idempotencyKey: 'sales-supervised-send:gate-123',
    input: {
      fromIdentity: 'sales',
      to: [{ email: 'prospect@example.test', name: 'Synthetic Prospect' }],
      subject: 'Synthetic website discussion',
      textBody: 'Synthetic approved supervised message.',
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

  const result = await integration.execute(draftRequest());

  assert.equal(result.status, 'drafted');
  assert.equal(result.output.draftId, 'draft-123');
  assert.equal(result.output.messageId, 'msg-123');
  assert.equal(result.output.threadReference, 'thread-123');
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
  assert.match(decoded, /From: \"AxorOS Sales Team\" <sales@example\.test>/);
  assert.match(decoded, /To: \"Synthetic Prospect\" <prospect@example\.test>/);
  assert.match(decoded, /Subject: Synthetic website discussion/);
  assert.match(decoded, /Synthetic draft body\. Do not send\./);
});

test('reads one exact Gmail thread without creating, sending, or modifying mail', async () => {
  const { fetchImpl, calls } = makeFetch();
  const integration = createGmailDraftIntegration({
    clientId: 'client-id',
    clientSecret: 'client-secret',
    refreshToken: 'refresh-token',
    identityAddresses: { sales: 'sales@example.test' },
    fetchImpl,
  });

  const thread = await integration.readThread('thread-123');

  assert.equal(thread.threadReference, 'thread-123');
  assert.equal(thread.messages.length, 2);
  assert.deepEqual(thread.messages[0], {
    messageId: 'sent-123',
    threadReference: 'thread-123',
    from: 'sales@example.test',
    to: 'prospect@example.test',
    subject: 'Synthetic website discussion',
    internalDate: '1787250000000',
    snippet: 'Synthetic approved supervised message.',
    textBody: 'Synthetic approved supervised message.',
  });
  assert.deepEqual(thread.messages[1], {
    messageId: 'reply-456',
    threadReference: 'thread-123',
    from: 'Prospect <prospect@example.test>',
    to: 'sales@example.test',
    subject: 'Re: Synthetic website discussion',
    internalDate: '1787250300000',
    snippet: 'Thanks, please send more information.',
    textBody: 'Thanks, please send more information.',
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.url, 'https://oauth2.googleapis.com/token');
  assert.equal(calls[1]?.url, 'https://gmail.googleapis.com/gmail/v1/users/me/threads/thread-123?format=full');
  assert.equal(calls[1]?.init?.method, 'GET');
  assert.equal(calls.some((call) => call.url.includes('/drafts')), false);
  assert.equal(calls.some((call) => call.url.includes('/messages/send')), false);
});

test('exposes provider delivery-status evidence only when Gmail returns a delivery-status MIME part', async () => {
  const { fetchImpl } = makeFetch();
  const integration = createGmailDraftIntegration({
    clientId: 'client-id',
    clientSecret: 'client-secret',
    refreshToken: 'refresh-token',
    identityAddresses: { sales: 'sales@example.test' },
    fetchImpl,
  });

  const thread = await integration.readThread('thread-bounce');

  assert.equal(thread.messages.length, 2);
  assert.equal(thread.messages[0]?.deliveryStatusNotification, undefined);
  assert.equal(thread.messages[1]?.messageId, 'dsn-789');
  assert.equal(thread.messages[1]?.from, 'Mail Delivery Subsystem <mailer-daemon@example.test>');
  assert.equal(thread.messages[1]?.textBody, 'Delivery failed: address not found.');
  assert.equal(thread.messages[1]?.deliveryStatusNotification, true);
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

  await assert.rejects(() => integration.execute(draftRequest()), /No Gmail address configured for email identity sales/);
  assert.equal(calls.length, 0);
});

test('remains draft-only unless supervised Sales sending is explicitly enabled', () => {
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

test('sends through the existing Gmail integration only when supervised Sales sending is enabled', async () => {
  const { fetchImpl, calls } = makeFetch();
  const integration = createGmailDraftIntegration({
    clientId: 'client-id',
    clientSecret: 'client-secret',
    refreshToken: 'refresh-token',
    identityAddresses: { sales: 'sales@example.test' },
    allowSupervisedSalesSend: true,
    fetchImpl,
  });

  assert.deepEqual(integration.supportedModes, ['draft', 'live']);
  assert.deepEqual(integration.supportedOperations, ['create_draft', 'send_email']);

  const result = await integration.execute(sendRequest());
  assert.equal(result.status, 'succeeded');
  assert.equal(result.output.messageId, 'sent-123');
  assert.equal(result.output.threadReference, 'thread-123');
  assert.equal(result.externalReference, 'sent-123');
  assert.deepEqual(result.evidenceReferences, ['gmail:message:sent-123']);
  assert.equal(calls[1]?.url, 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send');
});

test('refuses supervised send without an idempotency key before calling Gmail', async () => {
  const { fetchImpl, calls } = makeFetch();
  const integration = createGmailDraftIntegration({
    clientId: 'client-id',
    clientSecret: 'client-secret',
    refreshToken: 'refresh-token',
    identityAddresses: { sales: 'sales@example.test' },
    allowSupervisedSalesSend: true,
    fetchImpl,
  });

  const { idempotencyKey: _omittedIdempotencyKey, ...request } = sendRequest();
  await assert.rejects(() => integration.execute(request), /requires an idempotencyKey/);
  assert.equal(calls.length, 0);
});

test('refuses live sending through a non-Sales identity or agent', async () => {
  const { fetchImpl, calls } = makeFetch();
  const integration = createGmailDraftIntegration({
    clientId: 'client-id',
    clientSecret: 'client-secret',
    refreshToken: 'refresh-token',
    identityAddresses: { sales: 'sales@example.test', support: 'support@example.test' },
    allowSupervisedSalesSend: true,
    fetchImpl,
  });

  const unsafeRequest = {
    ...sendRequest(),
    requestedBy: 'support_agent' as const,
    input: { ...sendRequest().input, fromIdentity: 'support' },
  };

  await assert.rejects(() => integration.execute(unsafeRequest), /only supports draft creation by default and supervised Sales sending/);
  assert.equal(calls.length, 0);
});
