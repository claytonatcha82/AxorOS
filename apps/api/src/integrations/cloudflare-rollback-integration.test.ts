import assert from 'node:assert/strict';
import test from 'node:test';
import { createCloudflareRollbackIntegration } from './cloudflare-rollback-integration.js';

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

test('rolls back a successful production deployment with Cloudflare Pages', async () => {
  let method = '';
  let url = '';
  const integration = createCloudflareRollbackIntegration({
    accountId: 'acct-1',
    apiToken: 'token-1',
    fetchImpl: async (input, init) => {
      method = init?.method ?? 'GET';
      url = String(input);
      return response({ success: true, result: { id: 'deploy-1', environment: 'production', url: 'https://client-site.pages.dev', latest_stage: { status: 'success' } } });
    },
  });

  const result = await integration.execute({
    integrationId: 'deployment.cloudflare.rollback',
    operation: 'rollback_production',
    requestedBy: 'production_agent',
    executionId: 'exec-rollback-1',
    correlationId: 'corr-rollback-1',
    mode: 'live',
    risk: 'critical',
    idempotencyKey: 'rollback:deploy-1',
    input: { projectName: 'client-site', deploymentId: 'deploy-1' },
  });

  assert.equal(method, 'POST');
  assert.match(url, /accounts\/acct-1\/pages\/projects\/client-site\/deployments\/deploy-1\/rollback$/);
  assert.equal(result.status, 'succeeded');
  assert.deepEqual(result.output, {
    projectName: 'client-site',
    deploymentId: 'deploy-1',
    environment: 'production',
    status: 'ready',
    url: 'https://client-site.pages.dev',
  });
});

test('blocks unauthorised rollback callers before Cloudflare is contacted', async () => {
  let calls = 0;
  const integration = createCloudflareRollbackIntegration({
    accountId: 'acct-1',
    apiToken: 'token-1',
    fetchImpl: async () => {
      calls += 1;
      return response({ success: true, result: {} });
    },
  });

  const result = await integration.execute({
    integrationId: 'deployment.cloudflare.rollback',
    operation: 'rollback_production',
    requestedBy: 'marketing_agent',
    executionId: 'exec-rollback-2',
    correlationId: 'corr-rollback-2',
    mode: 'live',
    risk: 'critical',
    idempotencyKey: 'rollback:blocked',
    input: { projectName: 'client-site', deploymentId: 'deploy-1' },
  });

  assert.equal(result.status, 'blocked');
  assert.equal(calls, 0);
});

test('redacts the Cloudflare token from rollback provider errors', async () => {
  const integration = createCloudflareRollbackIntegration({
    accountId: 'acct-1',
    apiToken: 'secret-token',
    fetchImpl: async () => response({ success: false, errors: [{ code: 10000, message: 'bad secret-token credential' }] }, 403),
  });

  const result = await integration.execute({
    integrationId: 'deployment.cloudflare.rollback',
    operation: 'rollback_production',
    requestedBy: 'human_executive',
    executionId: 'exec-rollback-3',
    correlationId: 'corr-rollback-3',
    mode: 'live',
    risk: 'critical',
    idempotencyKey: 'rollback:error',
    input: { projectName: 'client-site', deploymentId: 'deploy-1' },
  });

  assert.equal(result.status, 'failed');
  assert.match(String(result.output.providerErrorMessage), /\[REDACTED\]/);
  assert.doesNotMatch(String(result.output.providerErrorMessage), /secret-token/);
});
