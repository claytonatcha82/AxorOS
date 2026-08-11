import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assessDiscountRequest,
  getSalesCommercialAuthority,
  proposalCanBeSent,
  validateSalesProposalDraft,
  type SalesProposalDraft,
} from './sales-commercial-governance.js';

function validProposal(): SalesProposalDraft {
  return {
    proposalId: 'proposal-1',
    client: 'Example Client',
    opportunityId: 'opp-1',
    businessProblem: 'The current website is difficult to use on mobile.',
    recommendedSolution: 'Responsive website optimisation using approved services.',
    scope: ['Responsive remediation', 'SEO essentials'],
    deliverables: ['Updated responsive website', 'SEO implementation'],
    timeline: '4 weeks',
    investment: 20000,
    currency: 'ZAR',
    paymentSchedule: ['50% deposit', '50% before launch'],
    optionalServices: ['Ongoing maintenance'],
    assumptions: ['Client supplies approved brand assets'],
    exclusions: ['Paid advertising'],
    nextSteps: ['Approve proposal', 'Sign contract'],
    approvalStatus: 'draft',
    legalTermsModified: false,
  };
}

test('approved package pricing is autonomous but discounts require approval', () => {
  assert.equal(getSalesCommercialAuthority('approved_package_pricing'), 'autonomous');
  assert.equal(getSalesCommercialAuthority('approved_add_on_pricing'), 'autonomous');
  assert.equal(getSalesCommercialAuthority('discount'), 'approval_required');
  assert.equal(getSalesCommercialAuthority('unusual_payment_schedule'), 'approval_required');
  assert.equal(getSalesCommercialAuthority('permanent_pricing_change'), 'human_only');
  assert.equal(getSalesCommercialAuthority('major_contract_deviation'), 'human_only');
});

test('discount requests never receive autonomous approval', () => {
  const assessment = assessDiscountRequest();
  assert.equal(assessment.status, 'approval_required');
  assert.equal(assessment.autonomousDiscountAllowed, false);
  assert.deepEqual(assessment.requiredSequence, [
    'understand_objection',
    'clarify_value',
    'adjust_scope_if_appropriate',
    'offer_approved_payment_structure_if_applicable',
    'escalate_discount_if_justified',
  ]);
});

test('proposal remains unsendable until approval gate passes', () => {
  const proposal = validProposal();
  assert.equal(validateSalesProposalDraft(proposal).length, 0);
  assert.equal(proposalCanBeSent(proposal), false);
  proposal.approvalStatus = 'approved';
  assert.equal(proposalCanBeSent(proposal), true);
});

test('sales agent cannot independently modify legal terms', () => {
  const proposal = validProposal();
  proposal.approvalStatus = 'approved';
  proposal.legalTermsModified = true;
  const errors = validateSalesProposalDraft(proposal);
  assert.ok(errors.includes('Sales Agent may not modify legal terms independently.'));
  assert.equal(proposalCanBeSent(proposal), false);
});

test('proposal validation blocks incomplete commercial packages', () => {
  const proposal = validProposal();
  proposal.scope = [];
  proposal.paymentSchedule = [];
  proposal.currency = '';
  const errors = validateSalesProposalDraft(proposal);
  assert.ok(errors.includes('scope is required.'));
  assert.ok(errors.includes('paymentSchedule is required.'));
  assert.ok(errors.includes('currency is required.'));
});
