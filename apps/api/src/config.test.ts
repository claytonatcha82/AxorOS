import assert from 'node:assert/strict';
import test from 'node:test';
import { loadConfig } from './config.js';

test('loadConfig returns safe development defaults', () => {
  const config = loadConfig({});

  assert.deepEqual(config, {
    environment: 'development',
    host: '127.0.0.1',
    port: 3001,
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
