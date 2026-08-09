import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { createRequestHandler } from './app.js';
import type { ApiConfig } from './config.js';

const config: ApiConfig = {
  environment: 'test',
  host: '127.0.0.1',
  port: 3001,
  controlCenterUrl: 'http://localhost:5173',
};

async function withServer(run: (baseUrl: string) => Promise<void>): Promise<void> {
  const server = createServer(createRequestHandler(config));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');

  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

test('GET /api/v1 returns a versioned success envelope and request ID', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1`, {
      headers: { 'x-request-id': 'req-test-123' },
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-request-id'), 'req-test-123');
    assert.deepEqual(body, {
      ok: true,
      requestId: 'req-test-123',
      data: {
        service: 'axoros-api',
        apiVersion: 'v1',
        environment: 'test',
      },
    });
  });
});

test('unknown routes return a consistent error envelope', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/missing`);
    const body = await response.json() as { ok: boolean; requestId: string; error: { code: string } };

    assert.equal(response.status, 404);
    assert.equal(body.ok, false);
    assert.equal(body.error.code, 'not_found');
    assert.ok(body.requestId.length > 0);
    assert.equal(response.headers.get('x-request-id'), body.requestId);
  });
});

test('allowed Control Center origin receives CORS headers', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1`, {
      headers: { origin: 'http://localhost:5173' },
    });

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('access-control-allow-origin'), 'http://localhost:5173');
  });
});

test('disallowed CORS preflight is rejected', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1`, {
      method: 'OPTIONS',
      headers: { origin: 'https://attacker.example' },
    });
    const body = await response.json() as { error: { code: string } };

    assert.equal(response.status, 403);
    assert.equal(body.error.code, 'cors_origin_denied');
    assert.equal(response.headers.get('access-control-allow-origin'), null);
  });
});
