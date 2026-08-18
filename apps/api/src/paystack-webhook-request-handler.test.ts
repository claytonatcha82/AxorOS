import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import test from 'node:test';
import { createPaystackWebhookRequestHandler } from './paystack-webhook-request-handler.js';

async function withServer(handler: ReturnType<typeof createPaystackWebhookRequestHandler>, run: (port: number) => Promise<void>): Promise<void> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('test server did not bind to a TCP port');
  try {
    await run(address.port);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

async function send(port: number, options: { method?: string; body?: Buffer | string; signature?: string }) {
  return new Promise<{ statusCode: number; body: string }>((resolve, reject) => {
    const req = httpRequest({
      host: '127.0.0.1',
      port,
      path: '/api/v1/webhooks/paystack',
      method: options.method ?? 'POST',
      headers: {
        ...(options.signature ? { 'x-paystack-signature': options.signature } : {}),
        ...(options.body !== undefined ? { 'content-length': Buffer.byteLength(options.body) } : {}),
      },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      res.on('end', () => resolve({ statusCode: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    if (options.body !== undefined) req.write(options.body);
    req.end();
  });
}

const fallback = (_request: unknown, response: any) => {
  response.writeHead(404);
  response.end();
};

test('Paystack webhook endpoint accepts only POST', async () => {
  const handler = createPaystackWebhookRequestHandler({
    config: { paystackSecretKey: 'sk_test_example' },
    ingress: { async ingest() {} },
    fallback,
  });
  await withServer(handler, async (port) => {
    const result = await send(port, { method: 'GET' });
    assert.equal(result.statusCode, 405);
  });
});

test('Paystack webhook endpoint fails closed when provider is not configured', async () => {
  const handler = createPaystackWebhookRequestHandler({ config: {}, fallback });
  await withServer(handler, async (port) => {
    const result = await send(port, { body: '{}', signature: 'abc' });
    assert.equal(result.statusCode, 503);
    assert.match(result.body, /paystack_webhook_not_configured/);
  });
});

test('Paystack webhook endpoint requires signature before reading trusted input', async () => {
  let calls = 0;
  const handler = createPaystackWebhookRequestHandler({
    config: { paystackSecretKey: 'sk_test_example' },
    ingress: { async ingest() { calls += 1; } },
    fallback,
  });
  await withServer(handler, async (port) => {
    const result = await send(port, { body: '{}' });
    assert.equal(result.statusCode, 401);
    assert.equal(calls, 0);
  });
});

test('Paystack webhook endpoint preserves raw bytes and acknowledges only successful ingestion', async () => {
  const raw = Buffer.from('{"event":"charge.success","data":{"reference":"pay:1"}}');
  let captured: { rawBody: Buffer; signature: string | undefined } | undefined;
  const handler = createPaystackWebhookRequestHandler({
    config: { paystackSecretKey: 'sk_test_example' },
    ingress: { async ingest(input) { captured = input; } },
    fallback,
  });
  await withServer(handler, async (port) => {
    const result = await send(port, { body: raw, signature: 'signature-1' });
    assert.equal(result.statusCode, 204);
    assert.equal(result.body, '');
    assert.ok(captured);
    assert.deepEqual(captured.rawBody, raw);
    assert.equal(captured.signature, 'signature-1');
  });
});

test('Paystack webhook endpoint returns generic 401 for signature failure without leaking details', async () => {
  const handler = createPaystackWebhookRequestHandler({
    config: { paystackSecretKey: 'sk_test_example' },
    ingress: { async ingest() { throw new Error('Paystack webhook signature verification failed using secret material.'); } },
    fallback,
  });
  await withServer(handler, async (port) => {
    const result = await send(port, { body: '{}', signature: 'bad' });
    assert.equal(result.statusCode, 401);
    assert.match(result.body, /paystack_signature_invalid/);
    assert.doesNotMatch(result.body, /secret material/);
  });
});

test('Paystack webhook endpoint returns 500 for internal processing failure so provider may retry', async () => {
  const handler = createPaystackWebhookRequestHandler({
    config: { paystackSecretKey: 'sk_test_example' },
    ingress: { async ingest() { throw new Error('database connection reset'); } },
    fallback,
  });
  await withServer(handler, async (port) => {
    const result = await send(port, { body: '{}', signature: 'valid-shape' });
    assert.equal(result.statusCode, 500);
    assert.match(result.body, /paystack_webhook_processing_failed/);
    assert.doesNotMatch(result.body, /database connection reset/);
  });
});

test('Paystack webhook endpoint rejects bodies larger than 64 KiB before ingestion', async () => {
  let calls = 0;
  const handler = createPaystackWebhookRequestHandler({
    config: { paystackSecretKey: 'sk_test_example' },
    ingress: { async ingest() { calls += 1; } },
    fallback,
  });
  await withServer(handler, async (port) => {
    const result = await send(port, { body: Buffer.alloc(64 * 1024 + 1, 65), signature: 'signature-1' });
    assert.equal(result.statusCode, 413);
    assert.equal(calls, 0);
  });
});
