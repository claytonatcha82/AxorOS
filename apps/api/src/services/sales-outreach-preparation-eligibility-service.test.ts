import assert from 'node:assert/strict';
import test from 'node:test';
import type { WorkflowEventRecord } from '../data/operational-repository.js';
import { createSalesOutreachPreparationEligibilityService } from './sales-outreach-preparation-eligibility-service.js';

function record(overrides: Partial<WorkflowEventRecord> = {}, payloadOverrides: Record<string, unknown> = {}): WorkflowEventRecord {
  return {
    id: 'assessment-1',
    clientId: null,
    projectId: null,
    eventType: 'sales_opportunity_assessment_recorded',
    actorType: 'agent',
    actorId: 'sales_agent',
    payload: {
      leadId: 'lead-1',
      salesIntakeExecutionId: 'sales-intake-1',
      assessmentStatus: 'context_complete',
      missingInformation: [],
      atlasSourcePaths: [
        'Volume 1 - Agency/05 Client Acquisition/Lead Qualification.md',
        'Volume 1 - Agency/06 Sales System/Sales Agent.md',
      ],
      outreachAuthorised: false,
      pricingAuthorised: false,
      commercialCommitmentAuthorised: false,
      nextAction: 'prepare_governed_sales_context',
      ...payloadOverrides,
    },
    createdAt: '2026-08-20T18:00:00.000Z',
    ...overrides,
  };
}

function serviceFor(value: WorkflowEventRecord | null) {
  return createSalesOutreachPreparationEligibilityService({
    async getWorkflowEventById(id: string) {
      assert.equal(id, 'assessment-1');
      return value;
    },
  });
}

test('complete persisted Sales assessment becomes internal outreach-preparation eligible without send authority', async () => {
  const eligibility = await serviceFor(record()).evaluate('assessment-1');

  assert.equal(eligibility.eligible, true);
  assert.equal(eligibility.assessmentRecordId, 'assessment-1');
  assert.equal(eligibility.leadId, 'lead-1');
  assert.equal(eligibility.salesIntakeExecutionId, 'sales-intake-1');
  assert.equal(eligibility.preparationOnly, true);
  assert.equal(eligibility.outreachAuthorised, false);
  assert.equal(eligibility.sendAuthorised, false);
  assert.equal(eligibility.pricingAuthorised, false);
  assert.equal(eligibility.commercialCommitmentAuthorised, false);
  assert.equal(eligibility.nextAction, 'prepare_internal_outreach_draft');
  assert.deepEqual(eligibility.atlasSourcePaths, [
    'Volume 1 - Agency/05 Client Acquisition/Lead Qualification.md',
    'Volume 1 - Agency/06 Sales System/Sales Agent.md',
  ]);
});

test('incomplete persisted Sales assessment cannot become outreach-preparation eligible', async () => {
  await assert.rejects(
    () => serviceFor(record({}, {
      assessmentStatus: 'context_incomplete',
      missingInformation: ['decision_maker'],
      nextAction: 'retrieve_missing_sales_context',
    })).evaluate('assessment-1'),
    /context-complete/i,
  );
});

test('non-assessment workflow event cannot become outreach-preparation eligible', async () => {
  await assert.rejects(
    () => serviceFor(record({ eventType: 'lead_sales_handoff_eligibility_recorded' })).evaluate('assessment-1'),
    /persisted Sales opportunity assessment/i,
  );
});

test('assessment record with injected outreach authority fails closed', async () => {
  await assert.rejects(
    () => serviceFor(record({}, { outreachAuthorised: true })).evaluate('assessment-1'),
    /must not inherit outreach, pricing, or commercial commitment authority/i,
  );
});

test('missing persisted assessment record fails closed', async () => {
  await assert.rejects(
    () => serviceFor(null).evaluate('assessment-1'),
    /was not found/i,
  );
});
