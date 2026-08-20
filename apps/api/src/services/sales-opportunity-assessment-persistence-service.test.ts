import assert from 'node:assert/strict';
import test from 'node:test';
import { createSalesOpportunityAssessmentPersistenceService } from './sales-opportunity-assessment-persistence-service.js';
import type { SalesOpportunityAssessment } from './sales-opportunity-assessment-service.js';

function assessment(overrides: Partial<SalesOpportunityAssessment> = {}): SalesOpportunityAssessment {
  return {
    leadId: 'lead-1',
    salesIntakeExecutionId: 'sales-intake:lead-1',
    company: 'Example Engineering',
    contactName: 'Jane Doe',
    contactEmail: 'jane@example.com',
    source: 'google_places',
    opportunitySummary: 'Needs a stronger corporate website.',
    existingLeadScore: null,
    salesContext: {
      decisionMaker: 'Jane Doe',
      industry: 'Engineering',
      country: 'South Africa',
      businessSummary: 'Engineering services company.',
      websiteAudit: 'Public website is dated and difficult to navigate.',
      painPoints: ['dated website'],
      recommendedServices: ['website redesign'],
      priority: 'normal',
      confidence: 0.9,
      previousContact: 'none',
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

function repository() {
  const events: Array<Record<string, unknown>> = [];
  return {
    events,
    repo: {
      async getLeadById(id: string) {
        return id === 'lead-1' ? ({ id: 'lead-1' } as never) : null;
      },
      async createWorkflowEvent(input: Record<string, unknown>) {
        events.push(input);
        return { id: `event-${events.length}`, ...input } as never;
      },
    },
  };
}

test('durably records a Sales opportunity assessment without authorising consequential actions', async () => {
  const { repo, events } = repository();
  const service = createSalesOpportunityAssessmentPersistenceService(repo as never);

  const result = await service.persist({ assessment: assessment() });

  assert.equal(result.id, 'event-1');
  assert.equal(events.length, 1);
  assert.equal(events[0]?.eventType, 'sales_opportunity_assessment_recorded');
  assert.equal(events[0]?.actorType, 'agent');
  assert.equal(events[0]?.actorId, 'sales_agent');
  const payload = events[0]?.payload as Record<string, unknown>;
  assert.equal(payload.assessmentStatus, 'context_complete');
  assert.deepEqual(payload.missingInformation, []);
  assert.equal(payload.outreachAuthorised, false);
  assert.equal(payload.pricingAuthorised, false);
  assert.equal(payload.commercialCommitmentAuthorised, false);
  assert.equal(payload.nextAction, 'prepare_governed_sales_context');
});

test('persists incomplete context exactly as incomplete rather than inventing missing values', async () => {
  const { repo, events } = repository();
  const service = createSalesOpportunityAssessmentPersistenceService(repo as never);

  await service.persist({
    assessment: assessment({
      salesContext: {},
      assessmentStatus: 'context_incomplete',
      missingInformation: ['industry', 'country', 'website_audit'],
      nextAction: 'retrieve_missing_sales_context',
    }),
  });

  const payload = events[0]?.payload as Record<string, unknown>;
  assert.equal(payload.assessmentStatus, 'context_incomplete');
  assert.deepEqual(payload.missingInformation, ['industry', 'country', 'website_audit']);
  assert.deepEqual(payload.salesContext, {});
});

test('fails closed when the lead does not exist', async () => {
  const { repo, events } = repository();
  const service = createSalesOpportunityAssessmentPersistenceService(repo as never);

  await assert.rejects(
    () => service.persist({ assessment: assessment({ leadId: 'missing' }) }),
    /Lead not found: missing/,
  );
  assert.equal(events.length, 0);
});

test('requires Atlas provenance and forbids outreach, pricing, or commercial authority', async () => {
  const { repo, events } = repository();
  const service = createSalesOpportunityAssessmentPersistenceService(repo as never);

  await assert.rejects(
    () => service.persist({ assessment: assessment({ atlasSourcePaths: [] }) }),
    /authoritative Atlas source paths/i,
  );
  await assert.rejects(
    () => service.persist({ assessment: { ...assessment(), outreachAuthorised: true } as unknown as SalesOpportunityAssessment }),
    /must not authorise outreach/i,
  );
  await assert.rejects(
    () => service.persist({ assessment: { ...assessment(), pricingAuthorised: true } as unknown as SalesOpportunityAssessment }),
    /must not authorise pricing/i,
  );
  await assert.rejects(
    () => service.persist({ assessment: { ...assessment(), commercialCommitmentAuthorised: true } as unknown as SalesOpportunityAssessment }),
    /must not authorise commercial commitments/i,
  );
  assert.equal(events.length, 0);
});
