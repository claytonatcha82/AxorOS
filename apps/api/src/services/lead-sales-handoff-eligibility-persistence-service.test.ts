import assert from 'node:assert/strict';
import test from 'node:test';
import type { LeadSalesHandoffEligibility } from './lead-sales-handoff-eligibility-service.js';
import { createLeadSalesHandoffEligibilityPersistenceService } from './lead-sales-handoff-eligibility-persistence-service.js';

function eligibility(overrides: Partial<LeadSalesHandoffEligibility> = {}): LeadSalesHandoffEligibility {
  return {
    eligible: true,
    leadId: 'lead-1',
    qualificationRecordId: 'qualification-1',
    dispositionRecordId: 'disposition-1',
    reviewExecutionId: 'lead-qualification-review:disposition-1',
    reviewTaskId: 'lead-qualification-review-task:disposition-1',
    recommendedAction: 'approve_advance',
    humanApprovalActor: 'human_executive',
    atlasSourcePaths: ['Volume 1 - Agency/05 Client Acquisition/Lead Qualification.md'],
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

test('durably records approved Lead to Sales handoff eligibility without authorising Sales execution', async () => {
  const { repo, events } = repository();
  const service = createLeadSalesHandoffEligibilityPersistenceService(repo as never);

  const result = await service.persist({ eligibility: eligibility() });

  assert.equal(result.id, 'event-1');
  assert.equal(events.length, 1);
  assert.equal(events[0]?.eventType, 'lead_sales_handoff_eligibility_recorded');
  assert.equal(events[0]?.actorType, 'system');
  assert.deepEqual(events[0]?.payload, {
    leadId: 'lead-1',
    qualificationRecordId: 'qualification-1',
    dispositionRecordId: 'disposition-1',
    reviewExecutionId: 'lead-qualification-review:disposition-1',
    reviewTaskId: 'lead-qualification-review-task:disposition-1',
    eligible: true,
    recommendedAction: 'approve_advance',
    humanApprovalActor: 'human_executive',
    atlasSourcePaths: ['Volume 1 - Agency/05 Client Acquisition/Lead Qualification.md'],
    salesDispatchAuthorised: false,
    outreachAuthorised: false,
  });
});

test('fails closed when the lead does not exist', async () => {
  const { repo, events } = repository();
  const service = createLeadSalesHandoffEligibilityPersistenceService(repo as never);

  await assert.rejects(
    () => service.persist({ eligibility: eligibility({ leadId: 'missing' }) }),
    /Lead not found: missing/,
  );
  assert.equal(events.length, 0);
});

test('requires human executive approval and Atlas provenance', async () => {
  const { repo } = repository();
  const service = createLeadSalesHandoffEligibilityPersistenceService(repo as never);

  const wrongActor = { ...eligibility(), humanApprovalActor: 'executive_agent' } as unknown as LeadSalesHandoffEligibility;
  await assert.rejects(() => service.persist({ eligibility: wrongActor }), /human executive approval/i);
  await assert.rejects(() => service.persist({ eligibility: eligibility({ atlasSourcePaths: [] }) }), /Atlas source paths/i);
});

test('requires review and qualification identities', async () => {
  const { repo } = repository();
  const service = createLeadSalesHandoffEligibilityPersistenceService(repo as never);

  await assert.rejects(() => service.persist({ eligibility: eligibility({ qualificationRecordId: ' ' }) }), /qualificationRecordId is required/);
  await assert.rejects(() => service.persist({ eligibility: eligibility({ reviewExecutionId: ' ' }) }), /reviewExecutionId is required/);
});
