import assert from 'node:assert/strict';
import { createServer, type RequestListener } from 'node:http';
import test from 'node:test';
import type { GovernedPreviewProjectProvisionDependencies } from './agents/production-preview-provisioning-command.js';
import { createProductionProjectProvisionControlPlaneRequestHandler } from './production-project-provision-control-plane-request-handler.js';

const token = 'production-project-control-token-1234567890123456';
const controlCenterUrl = 'http://localhost:5173';

async function withServer(run: (baseUrl: string, calls: Array<Record<string, unknown>>) => Promise<void>) {
  const calls: Array<Record<string, unknown>> = [];
  const fallback: RequestListener = (_request, response) => {
    response.writeHead(418, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ fallback: true }));
  };
  const handler = createProductionProjectProvisionControlPlaneRequestHandler({
    config: { controlCenterUrl, controlPlaneToken: token },
    provisionDependencies: {} as GovernedPreviewProjectProvisionDependencies,
    async executeProvision(input) {
      calls.push(input as unknown as Record<string, unknown>);
      return {
        integrationId: 'deployment.cloudflare.project',
        operation: 'create_project',
        provider: 'cloudflare',
        mode: 'live',
        status: 'succeeded',
        output: {
          projectName: input.integrationRequest.input.projectName,
          productionBranch: input.integrationRequest.input.productionBranch,
          productionUrl: 'https://client-site.pages.dev',
        },
        evidenceReferences: ['cloudflare:pages:project:client-site'],
        retryable: false,
      };
    },
    fallback,
  });
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  try {
    await run(`http://127.0.0.1:${address.port}`, calls);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

const validBody = {
  commercialRecordReference: 'commercial-1',
  financeClearanceId: 'clearance-1',
  operationsReadinessId: 'operations-1',
  projectName: 'client-site',
  productionBranch: 'main',
  idempotencyKey: 'project:client-site:1',
};

test('authenticated project provisioning builds a governed live request', async () => {
  await withServer(async (baseUrl, calls) => {
    const response = await fetch(`${baseUrl}/api/v1/control/production/deployment/project`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', origin: controlCenterUrl },
      body: JSON.stringify(validBody),
    });
    const body = await response.json() as { ok: boolean; data: { project: { projectName: string }; evidenceReferences: string[] } };
    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.data.project.projectName, 'client-site');
    assert.deepEqual(body.data.evidenceReferences, ['cloudflare:pages:project:client-site']);
    assert.equal(calls.length, 1);
    const call = calls[0] as { integrationRequest?: { integrationId?: string; operation?: string; requestedBy?: string; mode?: string; risk?: string } };
    assert.equal(call.integrationRequest?.integrationId, 'deployment.cloudflare.project');
    assert.equal(call.integrationRequest?.operation, 'create_project');
    assert.equal(call.integrationRequest?.requestedBy, 'human_executive');
    assert.equal(call.integrationRequest?.mode, 'live');
    assert.equal(call.integrationRequest?.risk, 'high');
  });
});

test('unauthenticated caller cannot provision a deployment project', async () => {
  await withServer(async (baseUrl, calls) => {
    const response = await fetch(`${baseUrl}/api/v1/control/production/deployment/project`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(validBody),
    });
    assert.equal(response.status, 401);
    assert.equal(calls.length, 0);
  });
});

test('project provisioning rejects unsupported fields', async () => {
  await withServer(async (baseUrl, calls) => {
    const response = await fetch(`${baseUrl}/api/v1/control/production/deployment/project`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ ...validBody, configureDomain: true }),
    });
    assert.equal(response.status, 400);
    assert.equal(calls.length, 0);
  });
});

test('non-project-provisioning paths fall through unchanged', async () => {
  await withServer(async (baseUrl, calls) => {
    const response = await fetch(`${baseUrl}/api/v1`);
    assert.equal(response.status, 418);
    assert.equal(calls.length, 0);
  });
});
