import assert from 'node:assert/strict';
import { createServer, type RequestListener } from 'node:http';
import test from 'node:test';
import type { GovernedPreviewBuildDeploymentRequest } from './agents/production-preview-build-deployment-command.js';
import type { GovernedPreviewDeploymentDependencies } from './agents/production-preview-deployment-command.js';
import { createProductionPreviewControlPlaneRequestHandler } from './production-preview-control-plane-request-handler.js';

const token = 'production-preview-control-token-1234567890';
const controlCenterUrl = 'http://localhost:5173';

async function withServer(
  executePreview: (input: GovernedPreviewBuildDeploymentRequest) => Promise<unknown>,
  run: (baseUrl: string, calls: GovernedPreviewBuildDeploymentRequest[]) => Promise<void>,
) {
  const calls: GovernedPreviewBuildDeploymentRequest[] = [];
  const fallback: RequestListener = (_request, response) => {
    response.writeHead(418, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ fallback: true }));
  };

  const handler = createProductionPreviewControlPlaneRequestHandler({
    config: { controlCenterUrl, controlPlaneToken: token },
    previewDependencies: {} as GovernedPreviewDeploymentDependencies,
    executePreview: (async (input) => {
      calls.push(input);
      return executePreview(input);
    }) as typeof import('./agents/production-preview-build-deployment-command.js').executeGovernedPreviewBuildDeployment,
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

function successResult() {
  return {
    deployment: {
      integrationId: 'deployment.cloudflare.preview',
      operation: 'create_preview_deployment',
      provider: 'cloudflare',
      mode: 'live' as const,
      status: 'succeeded' as const,
      output: {
        projectName: 'client-site',
        deploymentId: 'deploy-1',
        environment: 'preview' as const,
        status: 'ready' as const,
        url: 'https://preview.pages.dev',
      },
      evidenceReferences: ['cloudflare:pages:preview:deploy-1'],
      retryable: false,
    },
    packagedFileCount: 3,
    packagedBytes: 1024,
    buildOutputDirectory: 'C:\\build\\dist',
  };
}

test('authenticated Human Executive can invoke the governed Production preview endpoint', async () => {
  await withServer(async () => successResult(), async (baseUrl, calls) => {
    const response = await fetch(`${baseUrl}/api/v1/control/production/deployment/preview`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        origin: controlCenterUrl,
      },
      body: JSON.stringify({
        commercialRecordReference: 'commercial-1',
        financeClearanceId: 'clearance-1',
        operationsReadinessId: 'operations-1',
        projectName: 'client-site',
        productionBranch: 'main',
        previewBranch: 'axoros-preview-1',
        buildOutputDirectory: 'C:\\build\\dist',
        idempotencyKey: 'preview:client-site:1',
        commitHash: 'abc123',
      }),
    });

    const body = await response.json() as {
      ok: boolean;
      data: { deployment: { deploymentId: string }; packagedFileCount: number; packagedBytes: number };
    };
    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.data.deployment.deploymentId, 'deploy-1');
    assert.equal(body.data.packagedFileCount, 3);
    assert.equal(body.data.packagedBytes, 1024);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.requestedBy, 'human_executive');
    assert.equal(calls[0]?.projectName, 'client-site');
    assert.ok(calls[0]?.executionId);
    assert.ok(calls[0]?.correlationId);
    assert.equal(calls[0]?.commitHash, 'abc123');
  });
});

test('unauthenticated caller cannot invoke Production preview deployment', async () => {
  await withServer(async () => successResult(), async (baseUrl, calls) => {
    const response = await fetch(`${baseUrl}/api/v1/control/production/deployment/preview`, { method: 'POST' });
    assert.equal(response.status, 401);
    assert.equal(calls.length, 0);
  });
});

test('preview endpoint surfaces authoritative pilot-disabled rejection without claiming deployment success', async () => {
  await withServer(async () => {
    throw new Error('live integration deployment.cloudflare.preview/create_preview_deployment blocked while pilot state is PILOT_DISABLED.');
  }, async (baseUrl, calls) => {
    const response = await fetch(`${baseUrl}/api/v1/control/production/deployment/preview`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        commercialRecordReference: 'commercial-1',
        financeClearanceId: 'clearance-1',
        operationsReadinessId: 'operations-1',
        projectName: 'client-site',
        productionBranch: 'main',
        previewBranch: 'axoros-preview-1',
        buildOutputDirectory: 'C:\\build\\dist',
        idempotencyKey: 'preview:client-site:blocked',
      }),
    });
    const body = await response.json() as { ok: boolean; error: { message: string } };
    assert.equal(response.status, 400);
    assert.equal(body.ok, false);
    assert.match(body.error.message, /PILOT_DISABLED/);
    assert.equal(calls.length, 1);
  });
});

test('unsupported Production preview fields are rejected before command execution', async () => {
  await withServer(async () => successResult(), async (baseUrl, calls) => {
    const response = await fetch(`${baseUrl}/api/v1/control/production/deployment/preview`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        commercialRecordReference: 'commercial-1',
        financeClearanceId: 'clearance-1',
        operationsReadinessId: 'operations-1',
        projectName: 'client-site',
        productionBranch: 'main',
        previewBranch: 'preview',
        buildOutputDirectory: 'C:\\build\\dist',
        idempotencyKey: 'preview:invalid',
        promoteToProduction: true,
      }),
    });
    assert.equal(response.status, 400);
    assert.equal(calls.length, 0);
  });
});

test('non-preview paths fall through unchanged', async () => {
  await withServer(async () => successResult(), async (baseUrl, calls) => {
    const response = await fetch(`${baseUrl}/api/v1`);
    assert.equal(response.status, 418);
    assert.equal(calls.length, 0);
  });
});
