import assert from 'node:assert/strict';
import test from 'node:test';
import type { WorkflowEventRecord } from '../data/operational-repository.js';
import { createSalesOutreachApprovalResolutionService } from './sales-outreach-approval-resolution-service.js';
import { createSalesOutreachApprovalService } from './sales-outreach-approval-service.js';
import type { SalesOpportunityDecisionResult } from './sales-opportunity-decision-service.js';

function decision(overrides: Partial<SalesOpportunityDecisionResult> = {}): SalesOpportunityDecisionResult {
  return {
    leadId: 'lead-1',
    salesIntakeExecutionId: 'sales-intake-1',
    company: 'Example Construction',
    decision: 'pursue',
    rationale: ['Strong project fit'],
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

function pendingRecord(overrides: Record<string, unknown> = {}): WorkflowEventRecord {
  return {
    id: 'approval-record-1',
    clientId: null,
    projectId: null,
    eventType: 'sales_outreach_approval_requested',
    actorType: 'agent',
    actorId: 'sales_agent',
    payload: {
      approvalRequestId: 'sales-outreach-approval:sales-intake-1',
      leadId: 'lead-1',
      salesIntakeExecutionId: 'sales-intake-1',
      company: 'Example Construction',
      decision: 'pursue',
      approvalRequired: true,
      approvalOwner: 'founder',
      status: 'pending_founder_approval',
      outreachAuthorised: false,
      pricingAuthorised: false,
      commercialCommitmentAuthorised: false,
      atlasSourcePaths: ['Volume 1 - Agency/01 - Ideal Client Profile.md'],
      ...overrides,
    },
    createdAt: new Date().toISOString(),
  };
}

function resolve(overrides: Partial<Parameters<ReturnType<typeof createSalesOutreachApprovalResolutionService>['resolve']>[0]> = {}) {
  const service = createSalesOutreachApprovalResolutionService();
  const currentDecision = decision();
  const request = createSalesOutreachApprovalService().request(currentDecision);
  return service.resolve({
    decision: currentDecision,
    request,
    approvalRecord: pendingRecord(),
    actor: 'founder',
    decisionOutcome: 'approved',
    ...overrides,
  });
}

test('approves a valid pending founder request and makes outreach eligible', () => {
  const result = resolve({ reason: 'Founder approved controlled outreach preparation.' });
  assert.equal(result.status, 'approved');
  assert.equal(result.outreachAuthorised, true);
  assert.equal(result.pricingAuthorised, false);
  assert.equal(result.commercialCommitmentAuthorised, false);
  assert.equal(result.nextAction, 'prepare_governed_outreach');
  assert.equal(result.actor, 'founder');
});

test('denies a valid pending founder request without authorising outreach', () => {
  const result = resolve({ decisionOutcome: 'denied', reason: 'Not a current priority.' });
  assert.equal(result.status, 'denied');
  assert.equal(result.outreachAuthorised, false);
  assert.equal(result.nextAction, 'hold_or_close_sales_opportunity');
});

test('rejects an unauthorized actor', () => {
  assert.throws(
    () => resolve({ actor: 'sales_agent' }),
    /can only be resolved by founder/,
  );
});

test('rejects a non-pursue original Sales decision', () => {
  assert.throws(
    () => resolve({ decision: decision({ decision: 'needs_information' }) }),
    /requires the original pursue decision/,
  );
});

test('rejects missing Atlas provenance', () => {
  assert.throws(
    () => resolve({ decision: decision({ atlasSourcePaths: [] }) }),
    /requires authoritative Atlas source paths/,
  );
});

test('rejects a non-pending approval record', () => {
  assert.throws(
    () => resolve({ approvalRecord: pendingRecord({ status: 'approved' }) }),
    /approval record is not pending/,
  );
});

test('rejects an approval record with mismatched lead identity', () => {
  assert.throws(
    () => resolve({ approvalRecord: pendingRecord({ leadId: 'different-lead' }) }),
    /does not match the original Sales decision/,
  );
});

test('rejects an approval record that already contains authority', () => {
  assert.throws(
    () => resolve({ approvalRecord: pendingRecord({ outreachAuthorised: true }) }),
    /must remain unauthorised before resolution/,
  );
});
