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
