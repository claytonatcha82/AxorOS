import assert from 'node:assert/strict';
import test from 'node:test';
import { canTransitionAgentExecution, requiresHumanOrExecutiveReview, runtimeRetryRoute } from './agent-runtime-lifecycle.js';

test('runtime lifecycle blocks invalid shortcuts', () => {
  assert.equal(canTransitionAgentExecution('queued', 'ready'), true);
  assert.equal(canTransitionAgentExecution('queued', 'completed'), false);
  assert.equal(canTransitionAgentExecution('completed', 'in_progress'), false);
});

test('runtime lifecycle supports governed approval review and resume', () => {
  assert.equal(canTransitionAgentExecution('ready', 'review'), true);
  assert.equal(canTransitionAgentExecution('review', 'ready'), true);
  assert.equal(canTransitionAgentExecution('review', 'escalated'), true);
});

test('runtime lifecycle supports scheduling wait and resume', () => {
  assert.equal(canTransitionAgentExecution('ready', 'waiting'), true);
  assert.equal(canTransitionAgentExecution('waiting', 'ready'), true);
});

test('runtime lifecycle supports critical pre-execution governance escalation', () => {
  assert.equal(canTransitionAgentExecution('ready', 'escalated'), true);
});

test('retry policy follows operations safeguards', () => {
  assert.equal(runtimeRetryRoute(1, false), 'retry_same');
  assert.equal(runtimeRetryRoute(2, false), 'retry_alternative');
  assert.equal(runtimeRetryRoute(3, false), 'escalate');
  assert.equal(runtimeRetryRoute(1, true), 'escalate');
});

test('review and escalation require higher-level attention', () => {
  assert.equal(requiresHumanOrExecutiveReview('review'), true);
  assert.equal(requiresHumanOrExecutiveReview('escalated'), true);
  assert.equal(requiresHumanOrExecutiveReview('in_progress'), false);
});
