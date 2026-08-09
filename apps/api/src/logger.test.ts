import assert from 'node:assert/strict';
import test from 'node:test';
import { sanitizeLogFields } from './logger.js';

test('sanitizeLogFields redacts sensitive keys recursively', () => {
  const result = sanitizeLogFields({
    requestId: 'req-1',
    databaseUrl: 'postgresql://secret',
    nested: {
      apiKey: 'abc123',
      safe: 'visible',
    },
  });

  assert.equal(result.requestId, 'req-1');
  assert.equal(result.databaseUrl, '[REDACTED]');
  assert.deepEqual(result.nested, {
    apiKey: '[REDACTED]',
    safe: 'visible',
  });
});

test('sanitizeLogFields truncates excessively long strings', () => {
  const result = sanitizeLogFields({ message: 'x'.repeat(2_500) });
  assert.equal(typeof result.message, 'string');
  assert.match(result.message as string, /\[TRUNCATED\]$/);
});
