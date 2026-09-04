import assert from 'node:assert/strict';
import test from 'node:test';
import { createSalesOpportunityDecisionService } from './sales-opportunity-decision-service.js';
import type { SalesOpportunityAssessment } from './sales-opportunity-assessment-service.js';

function assessment(overrides: Partial<SalesOpportunityAssessment> = {}): SalesOpportunityAssessment {
  return {
    leadId: 'lead-1',
    salesIntakeExecutionId: 'sales-intake-1',
    company: 'Example Engineering',
    contactName: 'A Person',
    contactEmail: 'person@example.com',
    source: 'public_web',
    opportunitySummary: 'Evidence-backed website opportunity.',
    existingLeadScore: 42,
    salesContext: {
      decisionMaker: 'A Person',
      industry: 'Engineering',
      country: 'South Africa',
      businessSummary: 'Engineering services business.',
      websiteAudit: 'Public website evidence reviewed.',
      painPoints: ['Mobile usability opportunity'],
      recommendedServices: ['Website improvement assessment'],
      priority: 'normal',
      confidence: 0.8,
      previousContact: 'No previous contact recorded.',
    },
    assessmentStatus: 'context_complete',
    missingInformation: [],
    atlasSourcePaths: ['Volume 1 - Agency/06 Sales System/Sales Agent.md'],
    outreachAuthorised: false,
    pricingAuthorised: false,
    commercialCommitmentAuthorised: false,
    nextAction: 'prepare_governed_sales_context',
    ...overrides,
  };
}

test('pursues a complete qualifying opportunity but requests founder approval before outreach', () => {
  const result = createSalesOpportunityDecisionService().decide(assessment());
  assert.equal(result.decision, 'pursue');
  assert.equal(result.recommendedNextAction, 'request_founder_approval_for_outreach');
  assert.equal(result.outreachAuthorised, false);
  assert.equal(result.pricingAuthorised, false);
  assert.equal(result.commercialCommitmentAuthorised, false);
});

test('holds incomplete Sales context for more information', () => {
  const result = createSalesOpportunityDecisionService().decide(assessment({
    assessmentStatus: 'context_incomplete',
    missingInformation: ['decision_maker'],
  }));
  assert.equal(result.decision, 'needs_information');
  assert.equal(result.recommendedNextAction, 'retrieve_missing_sales_context');
});

test('does not pursue an opportunity below the governed Lead threshold', () => {
  const result = createSalesOpportunityDecisionService().decide(assessment({ existingLeadScore: 39 }));
  assert.equal(result.decision, 'do_not_pursue');
  assert.equal(result.recommendedNextAction, 'close_sales_opportunity');
});

test('holds low-confidence opportunity evidence', () => {
  const result = createSalesOpportunityDecisionService().decide(assessment({
    salesContext: { ...assessment().salesContext, confidence: 0.69 },
  }));
  assert.equal(result.decision, 'needs_information');
  assert.equal(result.recommendedNextAction, 'retrieve_missing_sales_context');
});

test('fails closed without Atlas provenance', () => {
  assert.throws(() => createSalesOpportunityDecisionService().decide(assessment({ atlasSourcePaths: [] })), /Atlas source paths/i);
});

test('fails closed if authority flags are altered', () => {
  assert.throws(() => createSalesOpportunityDecisionService().decide(assessment({ outreachAuthorised: true as false })), /outreach/i);
});
