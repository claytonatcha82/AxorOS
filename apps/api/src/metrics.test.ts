import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyHttpOutcome, getMetricsSnapshot, recordHttpRequest, recordReadinessFailure, resetMetricsForTests } from './metrics.js';

test('classifies HTTP outcomes by status code', () => {
  assert.equal(classifyHttpOutcome(200), 'success');
  assert.equal(classifyHttpOutcome(404), 'client_error');
  assert.equal(classifyHttpOutcome(503), 'server_error');
});

test('records request and readiness metrics', () => {
  resetMetricsForTests();
  recordHttpRequest(200, 10);
  recordHttpRequest(200, 30);
  recordHttpRequest(404, 5);
  recordReadinessFailure();

  const snapshot = getMetricsSnapshot();
  assert.equal(snapshot.requests.success.count, 2);
  assert.equal(snapshot.requests.success.averageDurationMs, 20);
  assert.equal(snapshot.requests.success.maxDurationMs, 30);
  assert.equal(snapshot.requests.client_error.count, 1);
  assert.equal(snapshot.requests.server_error.count, 0);
  assert.equal(snapshot.readinessFailures, 1);
});
