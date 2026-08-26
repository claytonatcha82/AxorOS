import assert from 'node:assert/strict';
import test from 'node:test';
import { createCloudflareProductionDeploymentIntegration } from './cloudflare-production-deployment-integration.js';

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const asset = {
  path: '/index.html',
  contentHash: '0123456789abcdef0123456789abcdef',
  contentType: 'text/html; charset=utf-8',
  contentBase64: Buffer.from('<html></html>').toString('base64'),
};

function request() {
  return {
    integrationId: 'deployment.cloudflare.production',
    operation: 'deploy_production',
    requestedBy: 'human_executive' as const,
    executionId: 'exec-1',
    correlationId: 'corr-1',
    mode: 'live' as const,
    risk: 'critical' as const,
    idempotencyKey: 'deploy-production-1',
    input: {
      projectName: 'client-site',
      productionBranch: 'main',
      assets: [asset],
      buildOutputDirectory: 'dist',
    },
  };
}

test('uploads missing assets and creates a production deployment on the production branch', async () => {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  const integration = createCloudflareProductionDeploymentIntegration({
    accountId: 'account-1',
    apiToken: 'secret-token',
    baseUrl: 'https://cloudflare.test',
    fetchImpl: async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      calls.push({ url, method, body: init?.body });
      if (url.endsWith('/upload-token')) return response({ success: true, result: { jwt: 'upload-jwt' } });
      if (url.endsWith('/pages/assets/check-missing')) return response({ success: true, result: [asset.contentHash] });
      if (url.endsWith('/pages/assets/upload')) return response({ success: true, result: {} });
      if (url.endsWith('/deployments')) {
        return response({
          success: true,
          result: {
            id: 'deployment-1',
            environment: 'production',
            url: 'https://client-site.pages.dev',
            latest_stage: { status: 'success' },
          },
        });
      }
      return response({ success: false, errors: [{ code: 404, message: 'unexpected request' }] }, 404);
    },
  });

  const result = await integration.execute(request());
  assert.equal(result.status, 'succeeded');
  assert.equal(result.output.environment, 'production');
  assert.equal(result.output.deploymentId, 'deployment-1');
  assert.deepEqual(result.evidenceReferences, ['cloudflare:pages:production:deployment-1']);
  assert.equal(calls.length, 4);
  assert.match(calls[3]!.url, /pages\/projects\/client-site\/deployments$/);
  assert.ok(calls[3]!.body instanceof FormData);
  const form = calls[3]!.body as FormData;
  assert.equal(form.get('branch'), 'main');
});

test('blocks callers other than Production or the Human Executive before network execution', async () => {
  let calls = 0;
  const integration = createCloudflareProductionDeploymentIntegration({
    accountId: 'account-1',
    apiToken: 'secret-token',
    fetchImpl: async () => {
      calls += 1;
      return response({ success: true, result: {} });
    },
  });

  const result = await integration.execute({ ...request(), requestedBy: 'operations_agent' });
  assert.equal(result.status, 'blocked');
  assert.equal(calls, 0);
});

test('fails closed when Cloudflare returns a non-production environment', async () => {
  let call = 0;
  const integration = createCloudflareProductionDeploymentIntegration({
    accountId: 'account-1',
    apiToken: 'secret-token',
    fetchImpl: async () => {
      call += 1;
      if (call === 1) return response({ success: true, result: { jwt: 'upload-jwt' } });
      if (call === 2) return response({ success: true, result: [] });
      return response({ success: true, result: { id: 'deployment-2', environment: 'preview' } });
    },
  });

  const result = await integration.execute(request());
  assert.equal(result.status, 'failed');
  assert.equal(result.output.environment, 'production');
  assert.match(result.output.providerErrorMessage ?? '', /did not classify/);
});

test('redacts the API token from provider errors', async () => {
  const integration = createCloudflareProductionDeploymentIntegration({
    accountId: 'account-1',
    apiToken: 'secret-token',
    fetchImpl: async () => response({
      success: false,
      errors: [{ code: 9100, message: 'bad secret-token credential' }],
    }, 403),
  });

  const result = await integration.execute(request());
  assert.equal(result.status, 'failed');
  assert.match(result.output.providerErrorMessage ?? '', /\[REDACTED\]/);
  assert.doesNotMatch(result.output.providerErrorMessage ?? '', /secret-token/);
});
