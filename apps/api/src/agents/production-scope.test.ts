import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateProductionScope } from './production-scope.js';

test('inside-scope production request is allowed', () => {
  const decision = evaluateProductionScope({
    request: 'Build the contact page and contact form',
    approvedScope: ['contact page', 'contact form', 'responsive layout'],
    excludedScope: ['booking system', 'ecommerce'],
  });

  assert.equal(decision.classification, 'inside_scope');
  assert.equal(decision.allowedToExecute, true);
  assert.ok(decision.matchedApprovedScope.includes('contact page'));
  assert.equal(decision.changeRequest, undefined);
});

test('explicitly excluded request is blocked and converted to a change request', () => {
  const decision = evaluateProductionScope({
    request: 'Please add a booking system to the website',
    approvedScope: ['five-page website', 'contact form'],
    excludedScope: ['booking system', 'online payments'],
  });

  assert.equal(decision.classification, 'outside_scope');
  assert.equal(decision.allowedToExecute, false);
  assert.ok(decision.matchedExcludedScope.includes('booking system'));
  assert.deepEqual(decision.changeRequest, {
    request: 'Please add a booking system to the website',
    scopeStatus: 'outside_scope',
    pricingRequired: true,
    approvalRequired: true,
    status: 'pending_review',
  });
});

test('untraceable requests are blocked for review instead of being silently implemented', () => {
  const decision = evaluateProductionScope({
    request: 'Add a customer loyalty portal',
    approvedScope: ['five-page marketing website', 'contact form'],
    excludedScope: [],
  });

  assert.equal(decision.classification, 'unclear');
  assert.equal(decision.allowedToExecute, false);
  assert.equal(decision.changeRequest, undefined);
  assert.match(decision.reason, /must be reviewed/);
});

test('blank production requests are rejected', () => {
  assert.throws(
    () => evaluateProductionScope({ request: '   ', approvedScope: [], excludedScope: [] }),
    /request is required/,
  );
});
