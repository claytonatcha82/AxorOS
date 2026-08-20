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
        return { id: `event-${events.length}`, ...input } as never;
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

test('preserves human approval authority and Atlas provenance', async () => {
  const { repo } = repository();
  const service = createLeadQualificationDispositionPersistenceService(repo as never);

  const withoutApproval = { ...disposition(), humanApprovalRequired: false } as unknown as LeadQualificationDisposition;
  await assert.rejects(
    () => service.persist({ leadId: 'lead-1', qualificationRecordId: 'qualification-1', disposition: withoutApproval }),
    /human approval authority/i,
  );

  await assert.rejects(
    () => service.persist({ leadId: 'lead-1', qualificationRecordId: 'qualification-1', disposition: disposition({ atlasSourcePaths: [] }) }),
    /authoritative Atlas source paths/i,
  );
});
