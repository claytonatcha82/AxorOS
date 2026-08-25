import assert from 'node:assert/strict';
import test from 'node:test';
import { loadConfig } from './config.js';

test('loadConfig reads Cloudflare credentials without silently activating deployment', () => {
  const config = loadConfig({
    AXOROS_CLOUDFLARE_ACCOUNT_ID: ' account-123 ',
    AXOROS_CLOUDFLARE_API_TOKEN: ' token-123 ',
  });

  assert.equal(config.cloudflareAccountId, 'account-123');
  assert.equal(config.cloudflareApiToken, 'token-123');
  assert.equal(config.deploymentIntegrationId, undefined);
});

test('loadConfig explicitly activates Cloudflare deployment with complete credentials', () => {
  const config = loadConfig({
    AXOROS_DEPLOYMENT_INTEGRATION: 'cloudflare',
    AXOROS_CLOUDFLARE_ACCOUNT_ID: 'account-123',
    AXOROS_CLOUDFLARE_API_TOKEN: 'token-123',
  });

  assert.equal(config.deploymentIntegrationId, 'deployment.cloudflare');
});

test('loadConfig rejects partial Cloudflare credentials', () => {
  assert.throws(
    () => loadConfig({ AXOROS_CLOUDFLARE_ACCOUNT_ID: 'account-123' }),
    /requires account ID and API token together/,
  );
});

test('loadConfig rejects Cloudflare activation without credentials', () => {
  assert.throws(
    () => loadConfig({ AXOROS_DEPLOYMENT_INTEGRATION: 'cloudflare' }),
    /requires AXOROS_CLOUDFLARE_ACCOUNT_ID and AXOROS_CLOUDFLARE_API_TOKEN/,
  );
});

test('loadConfig rejects unknown deployment integrations', () => {
  assert.throws(
    () => loadConfig({ AXOROS_DEPLOYMENT_INTEGRATION: 'unknown' }),
    /must be cloudflare/,
  );
});
