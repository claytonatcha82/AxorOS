import assert from 'node:assert/strict';
import test from 'node:test';
import { clientHealthScore, clientHealthStatus, recurringIncidentAction, validateExpansionSignal } from './support-client-health.js';

test('client health follows approved health bands', () => {
  assert.equal(clientHealthStatus(95), 'healthy');
  assert.equal(clientHealthStatus(82), 'stable');
  assert.equal(clientHealthStatus(68), 'attention');
  assert.equal(clientHealthStatus(45), 'at_risk');
});

test('client health combines operational commercial engagement and satisfaction inputs', () => {
  assert.equal(clientHealthScore({ supportTicketTrend: 90, websiteHealth: 90, paymentStatus: 90, engagement: 90, satisfaction: 90, contractRenewal: 90, performance: 90 }), 90);
});

test('expansion signals require evidence before Sales follow-up', () => {
  assert.deepEqual(validateExpansionSignal({ clientId: 'client-1', observedNeed: 'Repeated booking requests', evidence: ['ticket-10', 'ticket-14'], recommendedService: 'booking_system', urgency: 'medium', estimatedValueCategory: 'medium', salesFollowupRecommended: true }), []);
});

test('repeated root cause is escalated to Production rather than patched indefinitely', () => {
  assert.equal(recurringIncidentAction(1), 'normal_resolution');
  assert.equal(recurringIncidentAction(2), 'production_root_cause_escalation');
  assert.equal(recurringIncidentAction(5), 'production_root_cause_escalation');
});
