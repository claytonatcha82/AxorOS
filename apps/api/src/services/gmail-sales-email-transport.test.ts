import assert from 'node:assert/strict';
import test from 'node:test';

import { createGmailSalesEmailTransport } from './gmail-sales-email-transport.js';

test('refreshes OAuth token and sends a base64url Gmail message', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = async (input: string | URL, init?: RequestInit): Promise<Response> => {
    const url = input.toString();
    calls.push({ url, init });

    if (url === 'https://oauth2.googleapis.com/token') {
      return new Response(JSON.stringify({ access_token: 'access-token-demo' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    if (url === 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send') {
      return new Response(JSON.stringify({ id: 'gmail-message-123' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    return new Response('unexpected URL', { status: 500 });
  };

  const transport = createGmailSalesEmailTransport({
    clientId: 'client-id',
    clientSecret: 'client-secret',
    refreshToken: 'refresh-token',
    senderEmail: 'sales@axoros.example',
  }, fetchImpl);

  const result = await transport.send({
    to: 'prospect@example.com',
    subject: 'Website opportunity',
    body: 'Hello from AxorOS.',
  });

  assert.equal(result.providerMessageId, 'gmail-message-123');
  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.url, 'https://oauth2.googleapis.com/token');
  assert.equal(calls[1]?.url, 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send');

  const tokenBody = calls[0]?.init?.body;
  assert.ok(tokenBody instanceof URLSearchParams);
  assert.equal(tokenBody.get('grant_type'), 'refresh_token');
  assert.equal(tokenBody.get('refresh_token'), 'refresh-token');

  const sendHeaders = calls[1]?.init?.headers as Record<string, string>;
  assert.equal(sendHeaders.authorization, 'Bearer access-token-demo');
  const sendBody = JSON.parse(String(calls[1]?.init?.body)) as { raw: string };
  assert.match(sendBody.raw, /^[A-Za-z0-9_-]+$/);

  const padded = sendBody.raw.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(sendBody.raw.length / 4) * 4, '=');
  const decoded = Buffer.from(padded, 'base64').toString('utf8');
  assert.match(decoded, /From: sales@axoros\.example/);
  assert.match(decoded, /To: prospect@example\.com/);
  assert.match(decoded, /Subject: Website opportunity/);
  assert.match(decoded, /Hello from AxorOS\./);
});

test('refuses missing Gmail credentials before any network call', async () => {
  let calls = 0;
  const fetchImpl = async (): Promise<Response> => {
    calls += 1;
    return new Response('{}', { status: 200 });
  };

  assert.throws(
    () => createGmailSalesEmailTransport({
      clientId: '',
      clientSecret: 'secret',
      refreshToken: 'refresh',
      senderEmail: 'sales@axoros.example',
    }, fetchImpl),
    /GMAIL_CLIENT_ID is required/,
  );
  assert.equal(calls, 0);
});

test('does not attempt Gmail send when OAuth token refresh fails', async () => {
  let calls = 0;
  const fetchImpl = async (): Promise<Response> => {
    calls += 1;
    return new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 });
  };

  const transport = createGmailSalesEmailTransport({
    clientId: 'client-id',
    clientSecret: 'client-secret',
    refreshToken: 'bad-refresh-token',
    senderEmail: 'sales@axoros.example',
  }, fetchImpl);

  await assert.rejects(
    () => transport.send({ to: 'prospect@example.com', subject: 'Subject', body: 'Body' }),
    /Gmail OAuth token refresh failed with status 400/,
  );
  assert.equal(calls, 1);
});

test('rejects header injection before calling Gmail', async () => {
  let calls = 0;
  const fetchImpl = async (input: string | URL): Promise<Response> => {
    calls += 1;
    if (input.toString().includes('oauth2.googleapis.com')) {
      return new Response(JSON.stringify({ access_token: 'token' }), { status: 200 });
    }
    return new Response(JSON.stringify({ id: 'should-not-send' }), { status: 200 });
  };

  const transport = createGmailSalesEmailTransport({
    clientId: 'client-id',
    clientSecret: 'client-secret',
    refreshToken: 'refresh-token',
    senderEmail: 'sales@axoros.example',
  }, fetchImpl);

  await assert.rejects(
    () => transport.send({
      to: 'prospect@example.com',
      subject: 'Safe subject\r\nBcc: attacker@example.com',
      body: 'Body',
    }),
    /Email headers must not contain line breaks/,
  );
  assert.equal(calls, 1);
});
