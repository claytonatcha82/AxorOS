import assert from 'node:assert/strict';
import { createServer, type RequestListener } from 'node:http';
import test from 'node:test';
import type { RuntimeExecutionOutcome } from './agents/agent-runtime-orchestrator.js';
import { createPilotRuntimeControlPlaneRequestHandler } from './pilot-runtime-control-plane-request-handler.js';

const controlPlaneToken = 'pilot-runtime-control-token-1234567890';
const controlCenterUrl = 'http://localhost:5173';

function runtimeOutcome(status: 'ready' | 'review' = 'ready'): RuntimeExecutionOutcome {
  const now = '2026-08-24T18:00:00.000Z';
  return {
    replayed: false,
    record: {
      task: {
        taskId: 'task-pilot-runtime-control',
        executionId: 'exec-pilot-runtime-control',
        originAgent: 'operations_agent',
        destinationAgent: 'support_agent',
        objective: 'Operate a governed persisted Support task.',
        priority: 'normal',
        context: {},
        knowledgeReferences: [],
        inputs: {},
        expectedOutput: 'Governed result.',
        dependencies: [],
        risks: [],
        confidence: 1,
        approvalRequired: status === 'review',
        ...(status === 'review' ? { approvalOwner: 'human_executive' as const } : {}),
        status,
        nextAction: status === 'review' ? 'obtain_required_approval' : 'execute_destination_capability',
        attempt: 1,
        maxAttempts: 1,
        correlationId: 'corr-pilot-runtime-control',
        createdAt: now,
        updatedAt: now,
      },
      version: 1,
      persistedAt: now,
    },
  };
}

async function withServer(
  run: (baseUrl: string, calls: () => readonly string[]) => Promise<void>,
  token: string | null = controlPlaneToken,
): Promise<void> {
  const commandCalls: string[] = [];
  const fallback: RequestListener = (_request, response) => {
    response.writeHead(418, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ fallback: true }));
  };
  const handler = createPilotRuntimeControlPlaneRequestHandler({
    config: { controlCenterUrl, ...(token !== null ? { controlPlaneToken: token } : {}) },
    operatorCommand: {
      async listPendingApprovals() {
        commandCalls.push('list-pending');
        return [{
          executionId: 'exec-pending-support',
          destinationAgent: 'support_agent',
          objective: 'Draft a governed Support reply.',
          expectedOutput: 'One approved Gmail draft.',
          capabilityId: 'create_support_email_draft',
          persistedAt: '2026-08-24T18:00:00.000Z',
          reason: 'Stage 1 client communication requires Human Executive approval.',
        }];
      },
      async execute(executionId, capabilityId) {
        commandCalls.push(`execute:${executionId}:${capabilityId}`);
        return runtimeOutcome('ready');
      },
      async resolveApproval(executionId, decision, reason) {
        commandCalls.push(`approval:${executionId}:${decision}:${reason ?? ''}`);
        return runtimeOutcome('ready');
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

test('authenticated pending approval listing returns only operator-provided actionable records', async () => {
  await withServer(async (baseUrl, calls) => {
    const response = await fetch(`${baseUrl}/api/v1/control/runtime/approvals/pending`, {
      headers: {
        authorization: `Bearer ${controlPlaneToken}`,
        origin: controlCenterUrl,
      },
    });
    const body = await response.json() as { ok: boolean; data: { approvals: Array<{ executionId: string; capabilityId: string }> } };
    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.deepEqual(body.data.approvals.map(({ executionId, capabilityId }) => ({ executionId, capabilityId })), [{
      executionId: 'exec-pending-support',
      capabilityId: 'create_support_email_draft',
    }]);
    assert.equal(response.headers.get('access-control-allow-origin'), controlCenterUrl);
    assert.deepEqual(calls(), ['list-pending']);
  });
});

test('authenticated pilot runtime execute command accepts only executionId and capabilityId', async () => {
  await withServer(async (baseUrl, calls) => {
    const response = await fetch(`${baseUrl}/api/v1/control/runtime/execute`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${controlPlaneToken}`,
        'content-type': 'application/json',
        origin: controlCenterUrl,
      },
      body: JSON.stringify({ executionId: 'exec-pilot-runtime-control', capabilityId: 'analyse_support_incident' }),
    });
    const body = await response.json() as { ok: boolean; data: { destinationAgent: string; status: string } };
    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.data.destinationAgent, 'support_agent');
    assert.equal(body.data.status, 'ready');
    assert.equal(response.headers.get('access-control-allow-origin'), controlCenterUrl);
    assert.deepEqual(calls(), ['execute:exec-pilot-runtime-control:analyse_support_incident']);
  });
});

test('pilot runtime execute endpoint rejects fields that could bypass server governance', async () => {
  await withServer(async (baseUrl, calls) => {
    const response = await fetch(`${baseUrl}/api/v1/control/runtime/execute`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${controlPlaneToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        executionId: 'exec-pilot-runtime-control',
        capabilityId: 'analyse_support_incident',
        actor: 'executive_agent',
      }),
    });
    const body = await response.json() as { error: { code: string } };
    assert.equal(response.status, 400);
    assert.equal(body.error.code, 'invalid_runtime_execute_command');
    assert.equal(calls().length, 0);
  });
});

test('authenticated approval resolution does not accept an actor from the client', async () => {
  await withServer(async (baseUrl, calls) => {
    const rejected = await fetch(`${baseUrl}/api/v1/control/runtime/approval/resolve`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${controlPlaneToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        executionId: 'exec-pilot-runtime-control',
        decision: 'approved',
        actor: 'operations_agent',
      }),
    });
    assert.equal(rejected.status, 400);
    assert.equal(calls().length, 0);

    const approved = await fetch(`${baseUrl}/api/v1/control/runtime/approval/resolve`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${controlPlaneToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        executionId: 'exec-pilot-runtime-control',
        decision: 'approved',
        reason: 'Human Executive reviewed the task.',
      }),
    });
    assert.equal(approved.status, 200);
    assert.deepEqual(calls(), [
      'approval:exec-pilot-runtime-control:approved:Human Executive reviewed the task.',
    ]);
  });
});

test('pilot runtime control endpoints reject missing authentication before command execution', async () => {
  await withServer(async (baseUrl, calls) => {
    const response = await fetch(`${baseUrl}/api/v1/control/runtime/execute`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ executionId: 'exec-pilot-runtime-control', capabilityId: 'analyse_support_incident' }),
    });
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('www-authenticate'), 'Bearer');
    assert.equal(calls().length, 0);
  });
});

test('pending approval listing rejects missing authentication before command execution', async () => {
  await withServer(async (baseUrl, calls) => {
    const response = await fetch(`${baseUrl}/api/v1/control/runtime/approvals/pending`);
    assert.equal(response.status, 401);
    assert.equal(calls().length, 0);
  });
});

test('pilot runtime control endpoint fails closed when control-plane auth is not configured', async () => {
  await withServer(async (baseUrl, calls) => {
    const response = await fetch(`${baseUrl}/api/v1/control/runtime/execute`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${controlPlaneToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ executionId: 'exec-pilot-runtime-control', capabilityId: 'analyse_support_incident' }),
    });
    const body = await response.json() as { error: { code: string } };
    assert.equal(response.status, 503);
    assert.equal(body.error.code, 'control_plane_auth_not_configured');
    assert.equal(calls().length, 0);
  }, null);
});

test('non-pilot routes fall through unchanged', async () => {
  await withServer(async (baseUrl, calls) => {
    const response = await fetch(`${baseUrl}/api/v1`);
    const body = await response.json() as { fallback: boolean };
    assert.equal(response.status, 418);
    assert.equal(body.fallback, true);
    assert.equal(calls().length, 0);
  });
});
