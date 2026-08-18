import assert from 'node:assert/strict';
import { createServer, type RequestListener } from 'node:http';
import test from 'node:test';
import type { RuntimeExecutionOutcome } from './agents/agent-runtime-orchestrator.js';
import { createControlPlaneRequestHandler } from './control-plane-request-handler.js';

const controlPlaneToken = 'control-plane-test-token-1234567890abcdef';
const controlCenterUrl = 'http://localhost:5173';

function outcome(): RuntimeExecutionOutcome {
  const now = '2026-08-18T17:00:00.000Z';
  return {
    replayed: false,
    record: {
      task: {
        taskId: 'task-production-control',
        executionId: 'exec-production-control',
        originAgent: 'operations_agent',
        destinationAgent: 'production_agent',
        objective: 'Execute governed Production work.',
        priority: 'normal',
        context: {},
        knowledgeReferences: [],
        inputs: {},
        expectedOutput: 'Governed Production result.',
        dependencies: [],
        risks: [],
        confidence: 1,
        approvalRequired: false,
        status: 'completed',
        nextAction: 'done',
        attempt: 1,
        maxAttempts: 1,
        correlationId: 'corr-production-control',
        createdAt: now,
        updatedAt: now,
      },
      result: {
        executionId: 'exec-production-control',
        taskId: 'task-production-control',
        agentId: 'production_agent',
        status: 'completed',
        output: { draft: 'ok' },
        evidenceReferences: ['model:test:1'],
        knowledgeReferences: [],
        confidence: 1,
        completedAt: now,
      },
      version: 2,
      persistedAt: now,
    },
  };
}

async function withServer(
  run: (baseUrl: string, calls: () => number) => Promise<void>,
  token: string | undefined = controlPlaneToken,
): Promise<void> {
  let commandCalls = 0;
  const fallback: RequestListener = (_request, response) => {
    response.writeHead(418, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ fallback: true }));
  };
  const handler = createControlPlaneRequestHandler({
    config: { controlCenterUrl, ...(token ? { controlPlaneToken: token } : {}) },
    productionCommand: {
      async execute(executionId) {
        commandCalls += 1;
        assert.equal(executionId, 'exec-production-control');
        return outcome();
      },
    },
    fallback,
  });
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');

  try {
    await run(`http://127.0.0.1:${address.port}`, () => commandCalls);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test('authenticated Production control-plane request executes only the persisted execution ID', async () => {
  await withServer(async (baseUrl, calls) => {
    const response = await fetch(`${baseUrl}/api/v1/control/production/execute`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${controlPlaneToken}`,
        'content-type': 'application/json',
        origin: controlCenterUrl,
      },
      body: JSON.stringify({ executionId: 'exec-production-control' }),
    });
    const body = await response.json() as { ok: boolean; data: { executionId: string; status: string; resultStatus: string; replayed: boolean } };

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.deepEqual(body.data, {
      executionId: 'exec-production-control',
      status: 'completed',
      resultStatus: 'completed',
      replayed: false,
    });
    assert.equal(response.headers.get('access-control-allow-origin'), controlCenterUrl);
    assert.equal(calls(), 1);
  });
});

test('missing Production control-plane bearer token is rejected before command execution', async () => {
  await withServer(async (baseUrl, calls) => {
    const response = await fetch(`${baseUrl}/api/v1/control/production/execute`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ executionId: 'exec-production-control' }),
    });
    const body = await response.json() as { error: { code: string } };
    assert.equal(response.status, 401);
    assert.equal(body.error.code, 'control_plane_unauthorized');
    assert.equal(response.headers.get('www-authenticate'), 'Bearer');
    assert.equal(calls(), 0);
  });
});

test('invalid Production control-plane bearer token is rejected before command execution', async () => {
  await withServer(async (baseUrl, calls) => {
    const response = await fetch(`${baseUrl}/api/v1/control/production/execute`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer wrong-control-plane-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ executionId: 'exec-production-control' }),
    });
    assert.equal(response.status, 401);
    assert.equal(calls(), 0);
  });
});

test('Production control-plane endpoint fails closed when authentication is not configured', async () => {
  await withServer(async (baseUrl, calls) => {
    const response = await fetch(`${baseUrl}/api/v1/control/production/execute`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${controlPlaneToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ executionId: 'exec-production-control' }),
    });
    const body = await response.json() as { error: { code: string } };
    assert.equal(response.status, 503);
    assert.equal(body.error.code, 'control_plane_auth_not_configured');
    assert.equal(calls(), 0);
  }, undefined);
});

test('Production control-plane endpoint rejects payload fields that could bypass server governance', async () => {
  await withServer(async (baseUrl, calls) => {
    const response = await fetch(`${baseUrl}/api/v1/control/production/execute`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${controlPlaneToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        executionId: 'exec-production-control',
        financeClearanceId: 'caller-supplied-clearance',
      }),
    });
    const body = await response.json() as { error: { code: string } };
    assert.equal(response.status, 400);
    assert.equal(body.error.code, 'invalid_production_command');
    assert.equal(calls(), 0);
  });
});

test('Production control-plane preflight permits Authorization only for the configured Control Center origin', async () => {
  await withServer(async (baseUrl, calls) => {
    const allowed = await fetch(`${baseUrl}/api/v1/control/production/execute`, {
      method: 'OPTIONS',
      headers: { origin: controlCenterUrl },
    });
    assert.equal(allowed.status, 204);
    assert.match(allowed.headers.get('access-control-allow-headers') ?? '', /authorization/);
    assert.equal(allowed.headers.get('access-control-allow-origin'), controlCenterUrl);

    const denied = await fetch(`${baseUrl}/api/v1/control/production/execute`, {
      method: 'OPTIONS',
      headers: { origin: 'https://attacker.example' },
    });
    assert.equal(denied.status, 403);
    assert.equal(calls(), 0);
  });
});

test('non-control-plane routes continue through the existing API request handler', async () => {
  await withServer(async (baseUrl, calls) => {
    const response = await fetch(`${baseUrl}/api/v1`);
    const body = await response.json() as { fallback: boolean };
    assert.equal(response.status, 418);
    assert.equal(body.fallback, true);
    assert.equal(calls(), 0);
  });
});
