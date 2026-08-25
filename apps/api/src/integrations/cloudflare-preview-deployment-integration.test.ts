import assert from 'node:assert/strict';
import test from 'node:test';
import { createCloudflarePreviewDeploymentIntegration } from './cloudflare-preview-deployment-integration.js';

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const asset = {
  path: '/index.html',
  contentHash: '0123456789abcdef0123456789abcdef',
  contentType: 'text/html',
  contentBase64: 'PGgxPkF4b3JPUzwvaDE+',
};

test('uploads missing assets and creates a preview branch deployment', async () => {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  const integration = createCloudflarePreviewDeploymentIntegration({
    accountId: 'acct-1',
    apiToken: 'token-1',
    fetchImpl: async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      calls.push({ url, method, body: init?.body });
      if (url.endsWith('/upload-token')) return response({ success: true, result: { jwt: 'upload-jwt' } });
      if (url.endsWith('/pages/assets/check-missing')) return response({ success: true, result: [asset.contentHash] });
      if (url.endsWith('/pages/assets/upload')) return response({ success: true, result: {} }, 201);
      if (url.endsWith('/deployments')) return response({ success: true, result: { id: 'deploy-1', environment: 'preview', url: 'https://pilot.client-site.pages.dev', latest_stage: { status: 'success' } } });
      return response({ success: false, errors: [{ code: 404, message: 'unexpected request' }] }, 404);
    },
  });

  const result = await integration.execute({
    integrationId: 'deployment.cloudflare.preview',
    operation: 'create_preview_deployment',
    requestedBy: 'production_agent',
    executionId: 'exec-preview-1',
    correlationId: 'corr-preview-1',
    mode: 'live',
    risk: 'high',
    idempotencyKey: 'preview:client-site:1',
    input: {
      projectName: 'client-site',
      productionBranch: 'main',
      previewBranch: 'pilot-review',
      assets: [asset],
      commitHash: 'abc123',
      commitMessage: 'Pilot preview',
    },
  });

  assert.equal(result.status, 'succeeded');
  assert.equal(result.output.environment, 'preview');
  assert.equal(result.output.deploymentId, 'deploy-1');
  assert.equal(calls.length, 4);
  assert.match(calls[0]!.url, /pages\/projects\/client-site\/upload-token$/);
  assert.match(calls[1]!.url, /pages\/assets\/check-missing$/);
  assert.match(calls[2]!.url, /pages\/assets\/upload$/);
  assert.match(calls[3]!.url, /pages\/projects\/client-site\/deployments$/);

  const uploadBody = JSON.parse(String(calls[2]!.body)) as Array<Record<string, unknown>>;
  assert.equal(uploadBody[0]?.key, asset.contentHash);
  assert.equal(uploadBody[0]?.base64, true);

  assert.ok(calls[3]!.body instanceof FormData);
  const form = calls[3]!.body as FormData;
  assert.equal(form.get('branch'), 'pilot-review');
  assert.equal(form.get('commit_dirty'), 'false');
  assert.equal(form.get('manifest'), JSON.stringify({ '/index.html': asset.contentHash }));
});

test('does not allow a preview branch to equal the production branch', async () => {
  let calls = 0;
  const integration = createCloudflarePreviewDeploymentIntegration({
    accountId: 'acct-1',
    apiToken: 'token-1',
    fetchImpl: async () => {
      calls += 1;
      return response({ success: true, result: {} });
    },
  });

  const result = await integration.execute({
    integrationId: 'deployment.cloudflare.preview',
    operation: 'create_preview_deployment',
    requestedBy: 'production_agent',
    executionId: 'exec-preview-2',
    correlationId: 'corr-preview-2',
    mode: 'live',
    risk: 'high',
    idempotencyKey: 'preview:blocked',
    input: { projectName: 'client-site', productionBranch: 'main', previewBranch: 'main', assets: [asset] },
  });

  assert.equal(result.status, 'blocked');
  assert.equal(calls, 0);
});

test('blocks unauthorised preview deployment callers before Cloudflare is contacted', async () => {
  let calls = 0;
  const integration = createCloudflarePreviewDeploymentIntegration({
    accountId: 'acct-1',
    apiToken: 'token-1',
    fetchImpl: async () => {
      calls += 1;
      return response({ success: true, result: {} });
    },
  });

  const result = await integration.execute({
    integrationId: 'deployment.cloudflare.preview',
    operation: 'create_preview_deployment',
    requestedBy: 'marketing_agent',
    executionId: 'exec-preview-3',
    correlationId: 'corr-preview-3',
    mode: 'live',
    risk: 'high',
    idempotencyKey: 'preview:unauthorised',
    input: { projectName: 'client-site', productionBranch: 'main', previewBranch: 'pilot-review', assets: [asset] },
  });

  assert.equal(result.status, 'blocked');
  assert.equal(calls, 0);
});
