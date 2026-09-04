import assert from 'node:assert/strict';
import test from 'node:test';
import { createSalesOutreachApprovalService } from './sales-outreach-approval-service.js';
import type { SalesOpportunityDecisionResult } from './sales-opportunity-decision-service.js';

function decision(overrides: Partial<SalesOpportunityDecisionResult> = {}): SalesOpportunityDecisionResult {
  return {
    leadId: 'lead-1',
    salesIntakeExecutionId: 'sales-intake-1',
    company: 'Example Construction',
    decision: 'pursue',
    rationale: ['Strong project fit', 'Clear commercial opportunity'],
    missingInformation: [],
    confidence: 0.9,
    recommendedNextAction: 'request_founder_approval_for_outreach',
    outreachAuthorised: false,
    pricingAuthorised: false,
    commercialCommitmentAuthorised: false,
    atlasSourcePaths: ['Volume 1 - Agency/01 - Ideal Client Profile.md'],
    ...overrides,
  };
}

test('creates a founder approval request for a pursue decision', () => {
  const result = createSalesOutreachApprovalService().request(decision());
  assert.equal(result.decision, 'pursue');
  assert.equal(result.approvalRequired, true);
  assert.equal(result.approvalOwner, 'founder');
  assert.equal(result.status, 'pending_founder_approval');
  assert.equal(result.outreachAuthorised, false);
  assert.equal(result.pricingAuthorised, false);
  assert.equal(result.commercialCommitmentAuthorised, false);
});

test('rejects non-pursue decisions', () => {
  assert.throws(
    () => createSalesOutreachApprovalService().request(decision({ decision: 'needs_information' })),
    /only be requested for a pursue decision/,
  );
});

test('rejects missing Atlas provenance', () => {
  assert.throws(
    () => createSalesOutreachApprovalService().request(decision({ atlasSourcePaths: [] })),
    /requires authoritative Atlas source paths/,
  );
});

test('rejects pre-authorised outreach', () => {
  const preAuthorised = {
    ...decision(),
    outreachAuthorised: true,
  } as unknown as SalesOpportunityDecisionResult;

  assert.throws(
    () => createSalesOutreachApprovalService().request(preAuthorised),
    /must start with outreach unauthorised/,
  );
});
