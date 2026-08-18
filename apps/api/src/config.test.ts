import assert from 'node:assert/strict';
import test from 'node:test';
import { loadConfig } from './config.js';

test('loadConfig returns safe development defaults', () => {
  const config = loadConfig({});

  assert.deepEqual(config, {
    environment: 'development',
    host: '127.0.0.1',
    port: 3001,
    controlCenterUrl: 'http://localhost:5173',
  });
});

test('loadConfig rejects invalid environment values', () => {
  assert.throws(
    () => loadConfig({ AXOROS_ENV: 'unknown' }),
    /Invalid AXOROS_ENV/,
  );
});

test('loadConfig rejects invalid ports', () => {
  assert.throws(
    () => loadConfig({ AXOROS_API_PORT: '70000' }),
    /Invalid AXOROS_API_PORT/,
  );
});

test('loadConfig normalises the Control Center URL to an origin', () => {
  const config = loadConfig({ AXOROS_CONTROL_CENTER_URL: 'https://control.example.com/path' });
  assert.equal(config.controlCenterUrl, 'https://control.example.com');
});

test('loadConfig rejects invalid Control Center URLs', () => {
  assert.throws(
    () => loadConfig({ AXOROS_CONTROL_CENTER_URL: 'not-a-url' }),
    /Invalid AXOROS_CONTROL_CENTER_URL/,
  );
});

test('loadConfig reads a strong control-plane token from the environment', () => {
  const config = loadConfig({
    AXOROS_CONTROL_PLANE_TOKEN: '  control-plane-token-1234567890abcdef  ',
  });

  assert.equal(config.controlPlaneToken, 'control-plane-token-1234567890abcdef');
});

test('loadConfig rejects a weak control-plane token', () => {
  assert.throws(
    () => loadConfig({ AXOROS_CONTROL_PLANE_TOKEN: 'too-short' }),
    /at least 32 characters/,
  );
});

test('loadConfig reads Gemini credentials and optional model from environment', () => {
  const config = loadConfig({
    GEMINI_API_KEY: '  secret-key  ',
    AXOROS_GEMINI_MODEL: '  gemini-test-model  ',
  });

  assert.equal(config.geminiApiKey, 'secret-key');
  assert.equal(config.geminiModel, 'gemini-test-model');
});

test('loadConfig omits empty Gemini configuration', () => {
  const config = loadConfig({ GEMINI_API_KEY: '   ', AXOROS_GEMINI_MODEL: '   ' });
  assert.equal(config.geminiApiKey, undefined);
  assert.equal(config.geminiModel, undefined);
});

test('loadConfig reads complete Gmail draft credentials and identity addresses', () => {
  const config = loadConfig({
    AXOROS_GMAIL_CLIENT_ID: ' client-id ',
    AXOROS_GMAIL_CLIENT_SECRET: ' client-secret ',
    AXOROS_GMAIL_REFRESH_TOKEN: ' refresh-token ',
    AXOROS_GMAIL_IDENTITY_ADDRESSES: '{"sales":" sales@example.test ","support":"support@example.test"}',
  });

  assert.equal(config.gmailClientId, 'client-id');
  assert.equal(config.gmailClientSecret, 'client-secret');
  assert.equal(config.gmailRefreshToken, 'refresh-token');
  assert.deepEqual(config.gmailIdentityAddresses, {
    sales: 'sales@example.test',
    support: 'support@example.test',
  });
});

test('loadConfig rejects partial Gmail draft configuration', () => {
  assert.throws(
    () => loadConfig({ AXOROS_GMAIL_CLIENT_ID: 'client-id' }),
    /requires client ID, client secret, refresh token, and identity addresses together/,
  );
});

test('loadConfig rejects invalid Gmail identity JSON', () => {
  assert.throws(
    () => loadConfig({ AXOROS_GMAIL_IDENTITY_ADDRESSES: 'not-json' }),
    /Invalid AXOROS_GMAIL_IDENTITY_ADDRESSES JSON/,
  );
});

test('loadConfig reads a Paystack test secret key from the environment', () => {
  const config = loadConfig({ AXOROS_PAYSTACK_SECRET_KEY: '  sk_test_example-secret  ' });
  assert.equal(config.paystackSecretKey, 'sk_test_example-secret');
});

test('loadConfig reads a Paystack live secret key from the environment', () => {
  const config = loadConfig({ AXOROS_PAYSTACK_SECRET_KEY: 'sk_live_example-secret' });
  assert.equal(config.paystackSecretKey, 'sk_live_example-secret');
});

test('loadConfig rejects non-Paystack secret key formats', () => {
  assert.throws(
    () => loadConfig({ AXOROS_PAYSTACK_SECRET_KEY: 'not-a-paystack-key' }),
    /Paystack test or live secret key/,
  );
});
