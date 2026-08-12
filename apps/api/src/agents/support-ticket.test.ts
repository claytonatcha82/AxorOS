import assert from 'node:assert/strict';
import test from 'node:test';
import { classifySeverity, requiresImmediateGovernance, routeSupportRequest } from './support-ticket.js';

test('security compromise is P1 and triggers immediate governance', () => {
  const severity = classifySeverity({ businessImpact: 4, usersAffected: 4, revenueImpact: 3, securityImpact: 4, timeSensitivity: 4 });
  assert.equal(severity, 'P1');
  assert.equal(requiresImmediateGovernance('security_issue', severity), true);
});

test('routine included text update stays in support', () => {
  assert.equal(routeSupportRequest({ classification: 'content_update', includedInPlan: true, contractActive: true }), 'support');
});

test('new booking system is commercial scope rather than free support', () => {
  assert.equal(routeSupportRequest({ classification: 'feature_request', includedInPlan: false, contractActive: true }), 'sales_pricing');
});

test('expired support entitlement blocks silent free work', () => {
  assert.equal(routeSupportRequest({ classification: 'bug', includedInPlan: true, contractActive: false }), 'commercial_review');
});

test('client urgency alone cannot automatically create P1 severity', () => {
  assert.equal(classifySeverity({ businessImpact: 0, usersAffected: 0, revenueImpact: 0, securityImpact: 0, timeSensitivity: 4 }), 'P4');
});
