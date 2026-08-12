import assert from 'node:assert/strict';
import test from 'node:test';
import { canTransitionSupportIncident, recoveryAuthority, resolutionMayBeClaimed } from './support-incident.js';

test('incident lifecycle requires validation before communication and review', () => {
  assert.equal(canTransitionSupportIncident('detected', 'confirmed'), true);
  assert.equal(canTransitionSupportIncident('diagnosing', 'resolved'), true);
  assert.equal(canTransitionSupportIncident('resolved', 'validated'), true);
  assert.equal(canTransitionSupportIncident('resolved', 'communicated'), false);
});

test('initial recovery remains approval gated unless known safe tested and authorised', () => {
  assert.equal(recoveryAuthority({ knownSafeRecovery: false, heavilyTested: false, authorised: false, securityIncident: false }), 'recommend_for_approval');
  assert.equal(recoveryAuthority({ knownSafeRecovery: true, heavilyTested: true, authorised: true, securityIncident: false }), 'execute_and_verify');
});

test('security recovery never improvises and must escalate', () => {
  assert.equal(recoveryAuthority({ knownSafeRecovery: true, heavilyTested: true, authorised: true, securityIncident: true }), 'mandatory_escalation');
});

test('support cannot claim a fix before verification', () => {
  assert.equal(resolutionMayBeClaimed(false), false);
  assert.equal(resolutionMayBeClaimed(true), true);
});
