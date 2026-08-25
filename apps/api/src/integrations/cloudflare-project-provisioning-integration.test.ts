import assert from 'node:assert/strict';
import test from 'node:test';
import { createCloudflareProjectProvisioningIntegration } from './cloudflare-project-provisioning-integration.js';

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

test('creates an isolated Cloudflare Pages project with the requested production branch', async () => {
  let method = '';
  let body = '';
  const integration = createCloudflareProjectProvisioningIntegration({
    accountId: 'acct-1',
    apiToken: 'token-1',
    fetchImpl: async (_input, init) => {
      method = init?.method ?? 'GET';
      body = String(init?.body ?? '');
      return response({ success: true, result: { name: 'client-site', production_branch: 'main', subdomain: 'client-site.pages.dev' } });
    },
  });

  const result = await integration.execute({
    integrationId: 'deployment.cloudflare.project',
    operation: 'create_project',
    requestedBy: 'production_agent',
    executionId: 'exec-project-1',
    correlationId: 'corr-project-1',
    mode: 'live',
    risk: 'high',
    idempotencyKey: 'cloudflare-project:client-site',
    input: { projectName: 'client-site', productionBranch: 'main' },
  });

  assert.equal(method, 'POST');
  assert.deepEqual(JSON.parse(body), { name: 'client-site', production_branch: 'main' });
  assert.equal(result.status, 'succeeded');
  assert.deepEqual(result.output, { projectName: 'client-site', productionBranch: 'main', productionUrl: 'client-site.pages.dev' });
});

test('blocks unauthorised agents before Cloudflare is contacted', async () => {
  let calls = 0;
  const integration = createCloudflareProjectProvisioningIntegration({
    accountId: 'acct-1',
    apiToken: 'token-1',
    fetchImpl: async () => {
      calls += 1;
      return response({ success: true, result: {} });
    },
  });

  const result = await integration.execute({
    integrationId: 'deployment.cloudflare.project',
    operation: 'create_project',
    requestedBy: 'sales_agent',
    executionId: 'exec-project-2',
    correlationId: 'corr-project-2',
    mode: 'live',
    risk: 'high',
    idempotencyKey: 'cloudflare-project:blocked',
    input: { projectName: 'client-site', productionBranch: 'main' },
  });

  assert.equal(result.status, 'blocked');
  assert.equal(calls, 0);
});

test('redacts the Cloudflare token from project creation errors', async () => {
  const integration = createCloudflareProjectProvisioningIntegration({
    accountId: 'acct-1',
    apiToken: 'secret-token',
    fetchImpl: async () => response({ success: false, errors: [{ code: 10000, message: 'bad secret-token credential' }] }, 403),
  });

  const result = await integration.execute({
    integrationId: 'deployment.cloudflare.project',
    operation: 'create_project',
    requestedBy: 'human_executive',
    executionId: 'exec-project-3',
    correlationId: 'corr-project-3',
    mode: 'live',
    risk: 'high',
    idempotencyKey: 'cloudflare-project:error',
    input: { projectName: 'client-site', productionBranch: 'main' },
  });

  const message = String((result.output as { providerErrorMessage?: string }).providerErrorMessage);
  assert.match(message, /\[REDACTED\]/);
  assert.doesNotMatch(message, /secret-token/);
});
