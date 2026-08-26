import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { GovernedProductionBuildDeploymentRequest, GovernedProductionBuildDeploymentResult } from './agents/production-build-deployment-command.js';
import { createProductionDeploymentControlPlaneRequestHandler } from './production-deployment-control-plane-request-handler.js';

function request(body: unknown, authorization = 'Bearer control-token') {
  const req = new EventEmitter() as IncomingMessage & AsyncIterable<Buffer>;
  req.method = 'POST';
  req.url = '/api/v1/control/production/deployment/production';
  req.headers = { authorization, origin: 'http://localhost:3000' };
  req[Symbol.asyncIterator] = async function* () {
    yield Buffer.from(JSON.stringify(body));
  };
  return req;
}

function responseCapture() {
  let statusCode = 0;
  let body = '';
  const response = {
    writeHead(code: number) { statusCode = code; return response; },
    end(payload?: string) { if (payload) body += payload; },
  } as unknown as ServerResponse;
  return {
    response,
    get statusCode() { return statusCode; },
    get json() { return body ? JSON.parse(body) as Record<string, unknown> : {}; },
  };
}

const validBody = {
  authorityId: 'deploy-auth-1',
  commercialRecordReference: 'commercial-1',
  projectName: 'client-site',
  productionBranch: 'main',
  buildOutputDirectory: 'dist',
  idempotencyKey: 'production:client-site:1',
  commitHash: 'abc123',
  commitMessage: 'Approved release',
};

const succeeded: GovernedProductionBuildDeploymentResult = {
  deployment: {
    integrationId: 'deployment.cloudflare.production',
    operation: 'deploy_production',
    provider: 'cloudflare',
    mode: 'live',
    status: 'succeeded',
    output: {
      projectName: 'client-site',
      deploymentId: 'deploy-1',
      environment: 'production',
      status: 'ready',
    },
    evidenceReferences: ['cloudflare:pages:production:deploy-1'],
    retryable: false,
  },
  packagedFileCount: 2,
  packagedBytes: 123,
  buildOutputDirectory: 'C:/tmp/dist',
};

function dependencies(executeProduction: (input: GovernedProductionBuildDeploymentRequest) => Promise<GovernedProductionBuildDeploymentResult>) {
  return {
    config: { controlCenterUrl: 'http://localhost:3000', controlPlaneToken: 'control-token' },
    deploymentDependencies: {
      integrations: { get() { return undefined; }, async execute() { throw new Error('not used'); } },
      deploymentAuthorityStore: { async get() { return null; } },
    },
    executeProduction: async (input: GovernedProductionBuildDeploymentRequest) => executeProduction(input),
    fallback: (() => { throw new Error('fallback should not run'); }) as never,
  };
}

test('authenticated production endpoint constructs a human-executive strict deployment command', async () => {
  let captured: GovernedProductionBuildDeploymentRequest | undefined;
  const handler = createProductionDeploymentControlPlaneRequestHandler(dependencies(async (input) => {
    captured = input;
    return succeeded;
  }));
  const capture = responseCapture();
  await handler(request(validBody), capture.response);

  assert.equal(capture.statusCode, 200);
  assert.equal(captured?.requestedBy, 'human_executive');
  assert.equal(captured?.authorityId, 'deploy-auth-1');
  assert.equal(captured?.productionBranch, 'main');
  assert.ok(captured?.executionId);
  assert.ok(captured?.correlationId);
  assert.deepEqual((capture.json.data as Record<string, unknown>).evidenceReferences, ['cloudflare:pages:production:deploy-1']);
});

test('production endpoint rejects attempts to supply approval or QA flags', async () => {
  let calls = 0;
  const handler = createProductionDeploymentControlPlaneRequestHandler(dependencies(async () => {
    calls += 1;
    return succeeded;
  }));
  const capture = responseCapture();
  await handler(request({ ...validBody, clientApproved: true }), capture.response);

  assert.equal(capture.statusCode, 400);
  assert.equal(calls, 0);
  const error = capture.json.error as Record<string, unknown>;
  assert.equal(error.message, 'unexpected_field');
});

test('production endpoint requires authentication', async () => {
  const handler = createProductionDeploymentControlPlaneRequestHandler(dependencies(async () => succeeded));
  const capture = responseCapture();
  await handler(request(validBody, 'Bearer wrong-token'), capture.response);
  assert.equal(capture.statusCode, 401);
});

test('production endpoint propagates strict authority or pilot-gate rejection without reporting success', async () => {
  const handler = createProductionDeploymentControlPlaneRequestHandler(dependencies(async () => {
    throw new Error('external integration deployment.cloudflare.production/deploy_production blocked while pilot state is PILOT_DISABLED.');
  }));
  const capture = responseCapture();
  await handler(request(validBody), capture.response);

  assert.equal(capture.statusCode, 400);
  const error = capture.json.error as Record<string, unknown>;
  assert.equal(error.code, 'production_deployment_rejected');
  assert.match(String(error.message), /PILOT_DISABLED/);
});
