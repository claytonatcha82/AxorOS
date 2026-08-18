import assert from 'node:assert/strict';
import test from 'node:test';
import { authenticateControlPlaneRequest, validateControlPlaneToken } from './control-plane-auth.js';

const token = 'control-plane-token-1234567890abcdef';

test('validateControlPlaneToken trims and accepts a strong token', () => {
  assert.equal(validateControlPlaneToken(`  ${token}  `), token);
});

test('validateControlPlaneToken omits empty configuration', () => {
  assert.equal(validateControlPlaneToken(undefined), undefined);
  assert.equal(validateControlPlaneToken('   '), undefined);
});

test('validateControlPlaneToken rejects short secrets', () => {
  assert.throws(() => validateControlPlaneToken('too-short'), /at least 32 characters/);
});

test('authenticateControlPlaneRequest fails closed when authentication is not configured', () => {
  assert.deepEqual(authenticateControlPlaneRequest(`Bearer ${token}`, undefined), {
    authenticated: false,
    reason: 'not_configured',
  });
});

test('authenticateControlPlaneRequest requires a Bearer token', () => {
  assert.deepEqual(authenticateControlPlaneRequest(undefined, token), {
    authenticated: false,
    reason: 'missing_bearer_token',
  });
  assert.deepEqual(authenticateControlPlaneRequest(`Basic ${token}`, token), {
    authenticated: false,
    reason: 'missing_bearer_token',
  });
});

test('authenticateControlPlaneRequest rejects an incorrect Bearer token', () => {
  assert.deepEqual(authenticateControlPlaneRequest('Bearer wrong-control-plane-token-123456', token), {
    authenticated: false,
    reason: 'invalid_bearer_token',
  });
});

test('authenticateControlPlaneRequest accepts the configured Bearer token', () => {
  assert.deepEqual(authenticateControlPlaneRequest(`Bearer ${token}`, token), {
    authenticated: true,
  });
});
