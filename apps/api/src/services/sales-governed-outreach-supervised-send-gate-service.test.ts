import assert from 'node:assert/strict';
import test from 'node:test';
import type { WorkflowEventRecord } from '../data/operational-repository.js';
import { createSalesGovernedOutreachSupervisedSendGateService } from './sales-governed-outreach-supervised-send-gate-service.js';

function record(eventType: string, payload: unknown, actorType = 'founder', actorId: string | null = 'human_executive'): WorkflowEventRecord {
  return { id: `record-${eventType}`, clientId: null, projectId: null, eventType, actorType, actorId, payload, createdAt: new Date().toISOString() };
}

function repositoryFor(resolution: WorkflowEventRecord) {
  const events: WorkflowEventRecord[] = [];
  return {
    getWorkflowEventById: async (id: string) => id === resolution.id ? resolution : events.find((event) => event.id === id) ?? null,
    findWorkflowEventByTypeAndPayloadField: async (eventType: string, field: string, value: string) => events.find((event) => event.eventType === eventType && typeof event.payload === 'object' && event.payload !== null && !Array.isArray(event.payload) && String((event.payload as Record<string, unknown>)[field] ?? '') === value) ?? null,
    createWorkflowEvent: async (input: { eventType: string; actorType: 'founder' | 'agent' | 'system' | 'client' | 'provider'; actorId?: string; payload?: unknown }) => {
      const created = record(input.eventType, input.payload ?? {}, input.actorType, input.actorId ?? null);
      events.push(created);
      return created;
    },
  };
}

function approvedResolution(overrides: Record<string, unknown> = {}): WorkflowEventRecord {
  return record('sales_governed_outreach_human_review_resolved', {
    reviewRequestRecordId: 'review-request-1',
    preparationRecordId: 'preparation-1',
    resolutionRecordId: 'approval-resolution-1',
    decision: 'approved',
    reviewer: 'human_executive',
    reviewComplete: true,
    preparationOnly: true,
    outreachAuthorised: false,
    dispatchAuthorised: false,
    sendAuthorised: false,
    pricingAuthorised: false,
    commercialCommitmentAuthorised: false,
    nextAction: 'prepare_supervised_send_gate',
    ...overrides,
  });
}

test('prepares supervised send gate without granting dispatch or send authority', async () => {
  const repository = repositoryFor(approvedResolution());
  const service = createSalesGovernedOutreachSupervisedSendGateService(repository);
  const result = await service.prepare('record-sales_governed_outreach_human_review_resolved');

  assert.equal(result.gate.status, 'ready_for_supervised_send');
  assert.equal(result.gate.outreachAuthorised, true);
  assert.equal(result.gate.dispatchAuthorised, false);
  assert.equal(result.gate.sendAuthorised, false);
  assert.equal(result.gate.humanExecutionRequired, true);
  assert.equal(result.gate.nextAction, 'await_manual_send_execution');
});

test('rejects denied human review', async () => {
  const repository = repositoryFor(approvedResolution({ decision: 'denied', nextAction: 'hold_governed_outreach_preparation' }));
  const service = createSalesGovernedOutreachSupervisedSendGateService(repository);
  await assert.rejects(() => service.prepare('record-sales_governed_outreach_human_review_resolved'), /not valid for supervised send preparation/);
});

test('rejects forged dispatch or send authority in review resolution', async () => {
  const repository = repositoryFor(approvedResolution({ dispatchAuthorised: true }));
  const service = createSalesGovernedOutreachSupervisedSendGateService(repository);
  await assert.rejects(() => service.prepare('record-sales_governed_outreach_human_review_resolved'), /not valid for supervised send preparation/);
});

test('rejects non-human-executive resolution actor', async () => {
  const resolution = approvedResolution();
  resolution.actorId = 'sales_agent';
  const repository = repositoryFor(resolution);
  const service = createSalesGovernedOutreachSupervisedSendGateService(repository);
  await assert.rejects(() => service.prepare(resolution.id), /human executive review resolution/);
});

test('rejects duplicate supervised send gate', async () => {
  const resolution = approvedResolution();
  const repository = repositoryFor(resolution);
  const existing = await repository.createWorkflowEvent({
    eventType: 'sales_governed_outreach_supervised_send_gate_prepared',
    actorType: 'agent',
    actorId: 'sales_agent',
    payload: { humanReviewResolutionRecordId: resolution.id },
  });
  assert.equal(existing.eventType, 'sales_governed_outreach_supervised_send_gate_prepared');
  const service = createSalesGovernedOutreachSupervisedSendGateService(repository);
  await assert.rejects(() => service.prepare(resolution.id), /already been prepared/);
});
