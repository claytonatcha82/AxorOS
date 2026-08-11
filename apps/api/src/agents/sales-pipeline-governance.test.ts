import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canTransitionSalesStage,
  validateLostDealRecord,
  validateSalesNurtureRecord,
  validateSalesProductionHandover,
  type SalesProductionHandover,
} from './sales-pipeline-governance.js';

test('sales pipeline permits governed forward and nurture transitions', () => {
  assert.equal(canTransitionSalesStage('qualified', 'contacted'), true);
  assert.equal(canTransitionSalesStage('proposal', 'negotiation'), true);
  assert.equal(canTransitionSalesStage('proposal', 'nurture'), true);
  assert.equal(canTransitionSalesStage('nurture', 'contacted'), true);
  assert.equal(canTransitionSalesStage('won', 'proposal'), false);
  assert.equal(canTransitionSalesStage('qualified', 'won'), false);
});

test('nurture mode requires a follow-up record and never accepts opted-out prospects', () => {
  assert.deepEqual(validateSalesNurtureRecord({
    reason: 'not_now', followUpAt: '2026-11-01T09:00:00+02:00', notes: 'Revisit after budget cycle.', optedOut: false,
  }), []);

  const errors = validateSalesNurtureRecord({ reason: 'budget_timing', followUpAt: '', notes: '', optedOut: true });
  assert.ok(errors.includes('opted-out prospects cannot enter nurture mode.'));
  assert.ok(errors.includes('followUpAt is required.'));
});

test('lost deals capture actionable intelligence', () => {
  assert.deepEqual(validateLostDealRecord({ reason: 'price', detail: 'Budget below approved package floor.', reusableLearning: 'Qualify budget earlier.' }), []);
  assert.ok(validateLostDealRecord({ reason: 'competitor', detail: 'Selected incumbent supplier.' }).includes('competitor name or description is required for competitor losses.'));
});

function validHandover(): SalesProductionHandover {
  return {
    clientId: 'client-001', projectId: 'project-001', proposalAccepted: true, contractSigned: true,
    requiredPaymentConfirmed: true, onboardingComplete: true,
    approvedScope: ['Five-page business website'], deliverables: ['Responsive website', 'Contact form'],
    excludedScope: ['E-commerce'], timeline: '4 weeks', milestones: ['Plan', 'Build', 'QA', 'Launch'],
    clientExpectations: ['Professional mobile-first site'], knownRisks: [], openItems: [],
  };
}

test('sales to production handover is ready only after commercial gates pass', () => {
  const result = validateSalesProductionHandover(validHandover());
  assert.equal(result.ready, true);
  assert.deepEqual(result.missingRequirements, []);
});

test('production handover remains blocked until contract payment onboarding and scope are complete', () => {
  const handover = validHandover();
  handover.contractSigned = false;
  handover.requiredPaymentConfirmed = false;
  handover.onboardingComplete = false;
  handover.approvedScope = [];

  const result = validateSalesProductionHandover(handover);
  assert.equal(result.ready, false);
  assert.deepEqual(result.missingRequirements, ['contractSigned', 'requiredPaymentConfirmed', 'onboardingComplete', 'approvedScope']);
});
