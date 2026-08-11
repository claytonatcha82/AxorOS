import assert from 'node:assert/strict';
import test from 'node:test';
import { classifySalesResponse, evaluateSalesOutreachSafety, nextSalesActionForResponse } from './sales-outreach-policy.js';

test('safe draft remains non-sendable in V1 even after human approval', () => {
  const result = evaluateSalesOutreachSafety({
    recipientVerified: true,
    companyVerified: true,
    contextVerified: true,
    containsHallucinatedDetails: false,
    containsConfidentialInformation: false,
    signatureApproved: true,
    messagingCompliant: true,
    duplicateOutreach: false,
    priorOptOut: false,
    humanApproved: true,
  });

  assert.equal(result.status, 'draft_ready');
  assert.equal(result.sendAllowed, false);
  assert.deepEqual(result.blockingReasons, []);
});

test('opt-out and duplicate outreach block the draft', () => {
  const result = evaluateSalesOutreachSafety({
    recipientVerified: true,
    companyVerified: true,
    contextVerified: true,
    containsHallucinatedDetails: false,
    containsConfidentialInformation: false,
    signatureApproved: true,
    messagingCompliant: true,
    duplicateOutreach: true,
    priorOptOut: true,
    humanApproved: true,
  });

  assert.equal(result.status, 'blocked');
  assert.ok(result.blockingReasons.includes('duplicate_outreach_detected'));
  assert.ok(result.blockingReasons.includes('prior_opt_out'));
});

test('hallucinated personalisation blocks outreach', () => {
  const result = evaluateSalesOutreachSafety({
    recipientVerified: true,
    companyVerified: true,
    contextVerified: true,
    containsHallucinatedDetails: true,
    containsConfidentialInformation: false,
    signatureApproved: true,
    messagingCompliant: true,
    duplicateOutreach: false,
    priorOptOut: false,
    humanApproved: true,
  });

  assert.equal(result.status, 'blocked');
  assert.ok(result.blockingReasons.includes('hallucinated_details_detected'));
});

test('sales response classifications map to governed next actions', () => {
  assert.equal(nextSalesActionForResponse(classifySalesResponse('Interested')), 'prepare_discovery');
  assert.equal(nextSalesActionForResponse(classifySalesResponse('Price_Concern')), 'clarify_value_and_scope');
  assert.equal(nextSalesActionForResponse(classifySalesResponse('Unsubscribe')), 'do_not_contact');
  assert.equal(nextSalesActionForResponse(classifySalesResponse('Not_Now')), 'move_to_nurture');
});

test('unsupported response classifications are rejected', () => {
  assert.throws(() => classifySalesResponse('maybe-ish'), /Unsupported sales response classification/);
});
