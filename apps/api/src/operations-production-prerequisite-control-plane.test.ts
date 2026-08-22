import assert from 'node:assert/strict';
import { createServer, type RequestListener } from 'node:http';
import test from 'node:test';
import { createControlPlaneRequestHandler } from './control-plane-request-handler.js';

const controlPlaneToken = 'operations-prerequisite-control-test-token-1234567890';
const controlCenterUrl = 'http://localhost:5173';
const command = {
  commercialRecordReference: 'commercial:operations-prerequisite:1',
  prerequisite: 'contractSigned' as const,
  evidenceReference: 'contract-provider:document:1',
  observedAt: '2026-08-22T11:00:00.000Z',
};

async function withServer(
  run: (baseUrl: string, calls: () => number) => Promise<void>,
): Promise<void> {
  let prerequisiteCalls = 0;
  const fallback: RequestListener = (_request, response) => {
    response.writeHead(418, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ fallback: true }));
  };
  const handler = createControlPlaneRequestHandler({
    config: { controlCenterUrl, controlPlaneToken },
    productionCommand: {
      async execute() {
        throw new Error('Production command must not be called by prerequisite tests.');
      },
    },
    operationsProductionPrerequisiteCommand: {
      async record(input) {
        prerequisiteCalls += 1;
        assert.deepEqual(input, command);
        return {
          id: 'workflow-prerequisite:1',
          clientId: null,
          projectId: null,
          eventType: 'operations_contract_signed_verified',
          actorType: 'agent',
          actorId: 'operations_agent',
          payload: {
            commercialRecordReference: input.commercialRecordReference,
            verified: true,
            evidenceReference: input.evidenceReference,
            observedAt: input.observedAt,
          },
          createdAt: '2026-08-22T11:01:00.000Z',
        };
      },
    },
    fallback,
  });
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  try {
    await run(`http://127.0.0.1:${address.port}`, () => prerequisiteCalls);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

async function post(baseUrl: string, body: Record<string, unknown>, authenticated = true) {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    origin: controlCenterUrl,
  };
  if (authenticated) headers.authorization = `Bearer ${controlPlaneToken}`;
  const response = await fetch(`${baseUrl}/api/v1/control/operations/production-prerequisite/record`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  return { response, body: await response.json() as Record<string, unknown> };
}

test('authenticated Operations prerequisite control accepts only governed prerequisite evidence command', async () => {
  await withServer(async (baseUrl, calls) => {
    const result = await post(baseUrl, command);
    assert.equal(result.response.status, 200);
    assert.equal(result.body.ok, true);
    assert.deepEqual(result.body.data, {
      eventId: 'workflow-prerequisite:1',
      eventType: 'operations_contract_signed_verified',
      commercialRecordReference: command.commercialRecordReference,
    });
    assert.equal(result.response.headers.get('access-control-allow-origin'), controlCenterUrl);
    assert.equal(calls(), 1);
  });
});

test('Operations prerequisite control rejects invalid prerequisite and caller-supplied authority fields', async () => {
  await withServer(async (baseUrl, calls) => {
    const invalidBodies = [
      { ...command, prerequisite: 'paymentConfirmed' },
      { ...command, verified: true },
      { ...command, actorId: 'human_executive' },
      { ...command, actorType: 'founder' },
      { ...command, eventType: 'operations_contract_signed_verified' },
      { ...command, state: 'OPERATIONS_READY' },
      { ...command, evidenceReference: ' ' },
      { ...command, observedAt: 'not-a-date' },
    ];

    for (const body of invalidBodies) {
      const result = await post(baseUrl, body);
      assert.equal(result.response.status, 400);
      assert.equal((result.body.error as { code: string }).code, 'invalid_operations_production_prerequisite_command');
    }
    assert.equal(calls(), 0);
  });
});

test('Operations prerequisite control rejects unauthenticated recording before persistence', async () => {
  await withServer(async (baseUrl, calls) => {
    const result = await post(baseUrl, command, false);
    assert.equal(result.response.status, 401);
    assert.equal((result.body.error as { code: string }).code, 'control_plane_unauthorized');
    assert.equal(calls(), 0);
  });
});
