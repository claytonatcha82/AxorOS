import assert from 'node:assert/strict';
import test from 'node:test';
import type { CreateWorkflowEventInput, WorkflowEventRecord } from '../data/operational-repository.js';
import { createSalesOutreachApprovalResolutionPersistenceService } from './sales-outreach-approval-resolution-persistence-service.js';
import type { SalesOutreachApprovalResolution } from './sales-outreach-approval-resolution-service.js';

function resolution(overrides: Partial<SalesOutreachApprovalResolution> = {}): SalesOutreachApprovalResolution {
  return {
    approvalRequestId: 'sales-outreach-approval:sales-intake-1',
    approvalRecordId: 'approval-record-1',
    leadId: 'lead-1',
    salesIntakeExecutionId: 'sales-intake-1',
    company: 'Example Construction',
    decision: 'approved',
    status: 'approved',
    actor: 'founder',
    atlasSourcePaths: ['Volume 1 - Agency/01 - Ideal Client Profile.md'],
    outreachAuthorised: true,
    pricingAuthorised: false,
    commercialCommitmentAuthorised: false,
    nextAction: 'prepare_governed_outreach',
    ...overrides,
  };
}

function repository(existing: WorkflowEventRecord | null = null) {
  const events: WorkflowEventRecord[] = [];
  return {
    events,
    async findWorkflowEventByTypeAndPayloadField(): Promise<WorkflowEventRecord | null> { return existing; },
    async createWorkflowEvent(input: CreateWorkflowEventInput): Promise<WorkflowEventRecord> {
      const record: WorkflowEventRecord = {
        id: 'resolution-record-1',
        clientId: input.clientId ?? null,
        projectId: input.projectId ?? null,
        eventType: input.eventType,
        actorType: input.actorType,
        actorId: input.actorId ?? null,
        payload: input.payload ?? {},
        createdAt: new Date().toISOString(),
      };
      events.push(record);
      return record;
    },
  };
}

test('persists an approved Founder resolution with outreach eligibility only', async () => {
  const repo = repository();
  const record = await createSalesOutreachApprovalResolutionPersistenceService(repo).persist({ resolution: resolution() });
  const payload = record.payload as Record<string, unknown>;
  assert.equal(record.eventType, 'sales_outreach_approval_resolved');
  assert.equal(record.actorType, 'founder');
  assert.equal(payload.decision, 'approved');
  assert.equal(payload.outreachAuthorised, true);
  assert.equal(payload.pricingAuthorised, false);
  assert.equal(payload.commercialCommitmentAuthorised, false);
});

test('persists denied Founder resolution without outreach authority', async () => {
  const repo = repository();
  const record = await createSalesOutreachApprovalResolutionPersistenceService(repo).persist({
    resolution: resolution({ decision: 'denied', status: 'denied', outreachAuthorised: false, nextAction: 'hold_or_close_sales_opportunity' }),
  });
  const payload = record.payload as Record<string, unknown>;
  assert.equal(payload.decision, 'denied');
  assert.equal(payload.outreachAuthorised, false);
});

test('rejects a second resolution for an already-resolved approval', async () => {
  const repo = repository({
    id: 'existing-resolution', clientId: null, projectId: null,
    eventType: 'sales_outreach_approval_resolved', actorType: 'founder', actorId: 'founder', payload: {}, createdAt: new Date().toISOString(),
  });
  await assert.rejects(
    () => createSalesOutreachApprovalResolutionPersistenceService(repo).persist({ resolution: resolution() }),
    /has already been resolved/,
  );
});

test('rejects an approved resolution that does not authorise outreach eligibility', async () => {
  const repo = repository();
  await assert.rejects(
    () => createSalesOutreachApprovalResolutionPersistenceService(repo).persist({ resolution: resolution({ outreachAuthorised: false }) }),
    /must authorise outreach eligibility/,
  );
});
