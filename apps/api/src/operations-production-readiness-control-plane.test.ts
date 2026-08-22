import assert from 'node:assert/strict';
import { createServer, type RequestListener } from 'node:http';
import test from 'node:test';
import { createControlPlaneRequestHandler } from './control-plane-request-handler.js';

const controlPlaneToken = 'operations-control-plane-test-token-1234567890abcdef';
const controlCenterUrl = 'http://localhost:5173';
const assessment = {
  readinessId: 'operations-readiness:control-plane:1',
  commercialRecordReference: 'commercial:control-plane:1',
  assessedAt: '2026-08-22T10:40:00.000Z',
};

async function withServer(run: (baseUrl: string, calls: () => number) => Promise<void>): Promise<void> {
  let operationsCalls = 0;
  const fallback: RequestListener = (_request, response) => {
    response.writeHead(418, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ fallback: true }));
  };
  const handler = createControlPlaneRequestHandler({
    config: { controlCenterUrl, controlPlaneToken },
    productionCommand: {
      async execute() {
        throw new Error('Production command must not be called by Operations readiness tests.');
      },
    },
    operationsProductionReadinessCommand: {
      async assess(input) {
        operationsCalls += 1;
        assert.deepEqual(input, assessment);
        return {
          persistence: 'accepted',
          decision: {
            readinessId: input.readinessId,
            commercialRecordReference: input.commercialRecordReference,
            state: 'OPERATIONS_READY',
            contractSigned: true,
            onboardingComplete: true,
            assetsAvailable: true,
            planningComplete: true,
            evidenceReferences: [
              'workflow-event:contract',
              'workflow-event:onboarding',
              'workflow-event:assets',
              'workflow-event:planning',
            ],
            approvedBy: 'operations_agent',
            approvedAt: input.assessedAt,
          },
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
    await run(`http://127.0.0.1:${address.port}`, () => operationsCalls);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test('authenticated Operations readiness control accepts identifier-only assessment request', async () => {
  await withServer(async (baseUrl, calls) => {
    const response = await fetch(`${baseUrl}/api/v1/control/operations/production-readiness/assess`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${controlPlaneToken}`,
        'content-type': 'application/json',
        origin: controlCenterUrl,
      },
      body: JSON.stringify(assessment),
    });
    const body = await response.json() as {
      ok: boolean;
      data: { readinessId: string; commercialRecordReference: string; state: string; persistence: string };
    };
    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.deepEqual(body.data, {
      readinessId: assessment.readinessId,
      commercialRecordReference: assessment.commercialRecordReference,
      state: 'OPERATIONS_READY',
      persistence: 'accepted',
    });
    assert.equal(response.headers.get('access-control-allow-origin'), controlCenterUrl);
    assert.equal(calls(), 1);
  });
});

test('Operations readiness control rejects caller-supplied prerequisite and authority fields', async () => {
  await withServer(async (baseUrl, calls) => {
    for (const injected of [
      { contractSigned: true },
      { onboardingComplete: true },
      { assetsAvailable: true },
      { planningComplete: true },
      { evidenceReferences: ['caller:evidence'] },
      { state: 'OPERATIONS_READY' },
      { approvedBy: 'human_executive' },
    ]) {
      const response = await fetch(`${baseUrl}/api/v1/control/operations/production-readiness/assess`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${controlPlaneToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ ...assessment, ...injected }),
      });
      const body = await response.json() as { error: { code: string } };
      assert.equal(response.status, 400);
      assert.equal(body.error.code, 'invalid_operations_production_readiness_command');
    }
    assert.equal(calls(), 0);
  });
});

test('Operations readiness control rejects unauthenticated assessment before persistence', async () => {
  await withServer(async (baseUrl, calls) => {
    const response = await fetch(`${baseUrl}/api/v1/control/operations/production-readiness/assess`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(assessment),
    });
    assert.equal(response.status, 401);
    assert.equal(calls(), 0);
  });
});
