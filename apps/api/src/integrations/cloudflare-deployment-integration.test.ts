import assert from 'node:assert/strict';
import test from 'node:test';
import { createCloudflareDeploymentIntegration } from './cloudflare-deployment-integration.js';

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

test('reads Cloudflare project metadata without mutating provider state', async () => {
  let method = '';
  let url = '';
  const integration = createCloudflareDeploymentIntegration({
    accountId: 'acct-1',
    apiToken: 'token-1',
    fetchImpl: async (input, init) => {
      url = String(input);
      method = init?.method ?? 'GET';
      return response({ success: true, result: { name: 'client-site', production_branch: 'main', subdomain: 'client-site.pages.dev' } });
    },
  });

  const result = await integration.execute({
    integrationId: 'deployment.cloudflare',
    operation: 'get_project',
    requestedBy: 'operations_agent',
    executionId: 'exec-1',
    correlationId: 'corr-1',
    mode: 'sandbox',
    risk: 'low',
    input: { projectName: 'client-site' },
  });

  assert.equal(method, 'GET');
  assert.match(url, /accounts\/acct-1\/pages\/projects\/client-site$/);
  assert.equal(result.status, 'succeeded');
  assert.deepEqual(result.output, { projectName: 'client-site', productionBranch: 'main', productionUrl: 'client-site.pages.dev' });
});

test('reads Cloudflare deployment status as provider-neutral state', async () => {
  const integration = createCloudflareDeploymentIntegration({
    accountId: 'acct-1',
    apiToken: 'token-1',
    fetchImpl: async () => response({
      success: true,
      result: { id: 'deploy-1', environment: 'preview', url: 'https://deploy-1.pages.dev', created_on: '2026-08-25T18:00:00.000Z', latest_stage: { status: 'success' } },
    }),
  });

  const result = await integration.execute({
    integrationId: 'deployment.cloudflare',
    operation: 'get_deployment_status',
    requestedBy: 'production_agent',
    executionId: 'exec-2',
    correlationId: 'corr-2',
    mode: 'sandbox',
    risk: 'low',
    input: { projectName: 'client-site', deploymentId: 'deploy-1' },
  });

  assert.equal(result.status, 'succeeded');
  assert.deepEqual(result.output, {
    projectName: 'client-site',
    deploymentId: 'deploy-1',
    environment: 'preview',
    status: 'ready',
    url: 'https://deploy-1.pages.dev',
    createdAt: '2026-08-25T18:00:00.000Z',
  });
});

test('blocks unauthorised agents before Cloudflare is called', async () => {
  let calls = 0;
  const integration = createCloudflareDeploymentIntegration({
    accountId: 'acct-1',
    apiToken: 'token-1',
    fetchImpl: async () => {
      calls += 1;
      return response({ success: true, result: {} });
    },
  });

  const result = await integration.execute({
    integrationId: 'deployment.cloudflare',
    operation: 'get_project',
    requestedBy: 'sales_agent',
    executionId: 'exec-3',
    correlationId: 'corr-3',
    mode: 'sandbox',
    risk: 'low',
    input: { projectName: 'client-site' },
  });

  assert.equal(result.status, 'blocked');
  assert.equal(calls, 0);
});

test('redacts Cloudflare token from provider errors', async () => {
  const integration = createCloudflareDeploymentIntegration({
    accountId: 'acct-1',
    apiToken: 'secret-token',
    fetchImpl: async () => response({ success: false, errors: [{ code: 10000, message: 'bad secret-token credential' }] }, 403),
  });

  const result = await integration.execute({
    integrationId: 'deployment.cloudflare',
    operation: 'get_project',
    requestedBy: 'human_executive',
    executionId: 'exec-4',
    correlationId: 'corr-4',
    mode: 'sandbox',
    risk: 'low',
    input: { projectName: 'client-site' },
  });

  assert.equal(result.status, 'failed');
  assert.match(String((result.output as { providerErrorMessage?: string }).providerErrorMessage), /\[REDACTED\]/);
  assert.doesNotMatch(String((result.output as { providerErrorMessage?: string }).providerErrorMessage), /secret-token/);
});
