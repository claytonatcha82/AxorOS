import assert from 'node:assert/strict';
import test from 'node:test';
import { createLeadQualificationDispositionPersistenceService } from './lead-qualification-disposition-persistence-service.js';
import type { LeadQualificationDisposition } from './lead-qualification-disposition-service.js';

function disposition(overrides: Partial<LeadQualificationDisposition> = {}): LeadQualificationDisposition {
  return {
    disposition: 'hold',
    recommendedAction: 'collect_more_evidence',
    humanApprovalRequired: true,
    reasons: ['Qualification evidence is incomplete.'],
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
        return { id: `event-${events.length}`, createdAt: '2026-09-04T14:00:00.000Z', ...input } as never;
      },
    },
  };
}

test('durably records conservative lead disposition as a workflow event', async () => {
  const { repo, events } = repository();
  const service = createLeadQualificationDispositionPersistenceService(repo as never);

  const result = await service.persist({
    leadId: ' lead-1 ',
    qualificationRecordId: ' qualification-1 ',
    disposition: disposition(),
  });

  assert.equal(result.id, 'event-1');
  assert.equal(events.length, 1);
  assert.equal(events[0]?.eventType, 'lead_qualification_disposition_recorded');
  assert.equal(events[0]?.actorType, 'agent');
  assert.equal(events[0]?.actorId, 'lead_agent');
  assert.deepEqual(events[0]?.payload, {
    leadId: 'lead-1',
    qualificationRecordId: 'qualification-1',
    disposition: 'hold',
    recommendedAction: 'collect_more_evidence',
    humanApprovalRequired: true,
    reasons: ['Qualification evidence is incomplete.'],
    atlasSourcePaths: ['Volume 1 - Agency/05 Client Acquisition/Lead Qualification.md'],
  });
});

test('durably records a governed auto-advance disposition', async () => {
  const { repo, events } = repository();
  const service = createLeadQualificationDispositionPersistenceService(repo as never);

  const result = await service.persist({
    leadId: 'lead-1',
    qualificationRecordId: 'qualification-1',
    disposition: disposition({
      disposition: 'advance',
      recommendedAction: 'approve_advance',
      humanApprovalRequired: false,
      reasons: ['Atlas-backed qualification met the configured pilot auto-advance threshold.'],
    }),
  });

  assert.equal(result.id, 'event-1');
  assert.equal(events[0]?.payload && (events[0]?.payload as Record<string, unknown>).disposition, 'advance');
  assert.equal(events[0]?.payload && (events[0]?.payload as Record<string, unknown>).humanApprovalRequired, false);
});

test('fails closed when the lead does not exist', async () => {
  const { repo, events } = repository();
  const service = createLeadQualificationDispositionPersistenceService(repo as never);

  await assert.rejects(
    () => service.persist({ leadId: 'missing', qualificationRecordId: 'qualification-1', disposition: disposition() }),
    /Lead not found: missing/,
  );
  assert.equal(events.length, 0);
});

test('requires qualification record identity', async () => {
  const { repo } = repository();
  const service = createLeadQualificationDispositionPersistenceService(repo as never);

  await assert.rejects(
    () => service.persist({ leadId: 'lead-1', qualificationRecordId: '   ', disposition: disposition() }),
    /qualificationRecordId is required/,
  );
});

test('rejects inconsistent disposition authority combinations', async () => {
  const { repo } = repository();
  const service = createLeadQualificationDispositionPersistenceService(repo as never);

  await assert.rejects(
    () => service.persist({
      leadId: 'lead-1',
      qualificationRecordId: 'qualification-1',
      disposition: disposition({ disposition: 'advance', humanApprovalRequired: true, recommendedAction: 'approve_advance' }),
    }),
    /not a governed hold or auto-advance disposition/i,
  );

  await assert.rejects(
    () => service.persist({
      leadId: 'lead-1',
      qualificationRecordId: 'qualification-1',
      disposition: disposition({ disposition: 'advance', humanApprovalRequired: false, recommendedAction: 'review_fit' }),
    }),
    /not a governed hold or auto-advance disposition/i,
  );

  await assert.rejects(
    () => service.persist({
      leadId: 'lead-1',
      qualificationRecordId: 'qualification-1',
      disposition: disposition({ humanApprovalRequired: false }),
    }),
    /not a governed hold or auto-advance disposition/i,
  );
});

test('requires Atlas provenance for both governed outcomes', async () => {
  const { repo } = repository();
  const service = createLeadQualificationDispositionPersistenceService(repo as never);

  await assert.rejects(
    () => service.persist({ leadId: 'lead-1', qualificationRecordId: 'qualification-1', disposition: disposition({ atlasSourcePaths: [] }) }),
    /authoritative Atlas source paths/i,
  );

  await assert.rejects(
    () => service.persist({
      leadId: 'lead-1',
      qualificationRecordId: 'qualification-1',
      disposition: disposition({
        disposition: 'advance',
        recommendedAction: 'approve_advance',
        humanApprovalRequired: false,
        atlasSourcePaths: [],
      }),
    }),
    /authoritative Atlas source paths/i,
  );
});
