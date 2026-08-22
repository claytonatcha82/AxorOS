import assert from 'node:assert/strict';
import test from 'node:test';
import type { LeadRecord, WorkflowEventRecord } from '../data/operational-repository.js';
import type { SalesOutreachPreparationEligibility } from './sales-outreach-preparation-eligibility-service.js';
import { createSalesInternalOutreachDraftService } from './sales-internal-outreach-draft-service.js';

const now = '2026-08-20T18:00:00.000Z';

function lead(contactEmail: string | null = 'owner@example.com'): LeadRecord {
  return {
    id: 'lead-1',
    clientId: null,
    companyName: 'Example Co',
    contactName: 'Alex Owner',
    contactEmail,
    source: 'google_places',
    opportunitySummary: 'Website improvement opportunity.',
    leadScore: null,
    status: 'new',
    evidence: [],
    createdAt: now,
    updatedAt: now,
  };
}

function eligibility(): SalesOutreachPreparationEligibility {
  return {
    eligible: true,
    assessmentRecordId: 'assessment-1',
    leadId: 'lead-1',
    salesIntakeExecutionId: 'sales-intake-1',
    atlasSourcePaths: ['Volume 1 - Agency/06 Sales System/Sales Agent.md'],
    preparationOnly: true,
    outreachAuthorised: false,
    sendAuthorised: false,
    pricingAuthorised: false,
    commercialCommitmentAuthorised: false,
    nextAction: 'prepare_internal_outreach_draft',
  };
}

function createHarness(storedLead: LeadRecord = lead()) {
  const events: WorkflowEventRecord[] = [];
  const service = createSalesInternalOutreachDraftService({
    async getLeadById(id) {
      return id === storedLead.id ? storedLead : null;
    },
    async createWorkflowEvent(input) {
      const record: WorkflowEventRecord = {
        id: `event-${events.length + 1}`,
        clientId: null,
        projectId: null,
        eventType: input.eventType,
        actorType: input.actorType,
        actorId: input.actorId ?? null,
        payload: input.payload ?? {},
        createdAt: now,
      };
      events.push(record);
      return record;
    },
  });
  return { service, events };
}

test('creates an internal-review-required outreach draft without send authority', async () => {
  const { service, events } = createHarness();
  const result = await service.create({
    eligibility: eligibility(),
    subject: 'A possible improvement for Example Co',
    body: 'Draft body for internal review only.',
  });

  assert.equal(result.draft.recipientEmail, 'owner@example.com');
  assert.equal(result.draft.status, 'internal_review_required');
  assert.equal(result.draft.humanReviewRequired, true);
  assert.equal(result.draft.outreachAuthorised, false);
  assert.equal(result.draft.sendAuthorised, false);
  assert.equal(result.draft.pricingAuthorised, false);
  assert.equal(result.draft.commercialCommitmentAuthorised, false);
  assert.equal(result.draft.nextAction, 'request_human_outreach_draft_review');
  assert.equal(events.length, 1);
  assert.equal(events[0]?.eventType, 'sales_internal_outreach_draft_recorded');
  assert.equal(events[0]?.actorId, 'sales_agent');
});

test('refuses drafting when the lead has no persisted recipient email', async () => {
  const { service, events } = createHarness(lead(null));

  await assert.rejects(
    () => service.create({ eligibility: eligibility(), subject: 'Subject', body: 'Body' }),
    /lead\.contactEmail is required/i,
  );
  assert.equal(events.length, 0);
});

test('refuses drafting when eligibility carries outreach authority', async () => {
  const { service, events } = createHarness();
  const unsafe = { ...eligibility(), outreachAuthorised: true } as unknown as SalesOutreachPreparationEligibility;

  await assert.rejects(
    () => service.create({ eligibility: unsafe, subject: 'Subject', body: 'Body' }),
    /must not inherit outreach, send, pricing, or commercial commitment authority/i,
  );
  assert.equal(events.length, 0);
});

test('refuses blank candidate draft content', async () => {
  const { service, events } = createHarness();

  await assert.rejects(
    () => service.create({ eligibility: eligibility(), subject: '   ', body: 'Body' }),
    /subject is required/i,
  );
  await assert.rejects(
    () => service.create({ eligibility: eligibility(), subject: 'Subject', body: '   ' }),
    /body is required/i,
  );
  assert.equal(events.length, 0);
});
