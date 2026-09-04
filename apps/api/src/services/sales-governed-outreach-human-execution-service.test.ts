import assert from 'node:assert/strict';
import test from 'node:test';
import type { WorkflowEventRecord } from '../data/operational-repository.js';
import { createSalesGovernedOutreachHumanExecutionService } from './sales-governed-outreach-human-execution-service.js';

function record(id: string, eventType: string, actorType: string, actorId: string | null, payload: unknown): WorkflowEventRecord {
  return { id, clientId: null, projectId: null, eventType, actorType, actorId, payload, createdAt: new Date().toISOString() };
}

function fixtures() {
  const preparation = record('preparation-1', 'sales_governed_outreach_prepared', 'agent', 'sales_agent', {
    leadId: 'lead-1', recipientEmail: 'owner@example.com', subject: 'Website opportunity', body: 'Hello',
    preparationOnly: true, outreachAuthorised: true, dispatchAuthorised: false, sendAuthorised: false,
    pricingAuthorised: false, commercialCommitmentAuthorised: false, humanReviewRequired: true,
  });
  const gate = record('gate-1', 'sales_governed_outreach_supervised_send_gate_prepared', 'agent', 'sales_agent', {
    humanReviewResolutionRecordId: 'resolution-1', preparationRecordId: preparation.id, leadId: 'lead-1',
    status: 'ready_for_supervised_send', preparationOnly: true, outreachAuthorised: true,
    dispatchAuthorised: false, sendAuthorised: false, pricingAuthorised: false,
    commercialCommitmentAuthorised: false, humanExecutionRequired: true, nextAction: 'await_manual_send_execution',
  });
  return new Map<string, WorkflowEventRecord>([['gate-1', gate], ['preparation-1', preparation]]);
}

function harness(events = fixtures()) {
  const created: Array<{ eventType: string; actorType: string; actorId?: string; payload?: unknown }> = [];
  const repository = {
    async getWorkflowEventById(id: string) { return events.get(id) ?? null; },
    async findWorkflowEventByTypeAndPayloadField(eventType: string, field: string, value: string) {
      return [...events.values()].find((event) => event.eventType === eventType && typeof event.payload === 'object' && event.payload !== null && !Array.isArray(event.payload) && String((event.payload as Record<string, unknown>)[field] ?? '') === value) ?? null;
    },
    async createWorkflowEvent(input: { eventType: string; actorType: 'founder' | 'agent' | 'system' | 'client' | 'provider'; actorId?: string; payload?: unknown }) {
      created.push(input);
      const createdRecord = record(`created-${created.length}`, input.eventType, input.actorType, input.actorId ?? null, input.payload ?? {});
      events.set(createdRecord.id, createdRecord);
      return createdRecord;
    },
  };
  return { service: createSalesGovernedOutreachHumanExecutionService(repository), created };
}

test('explicit Human Executive execution creates send authority from the governed supervised gate', async () => {
  const { service, created } = harness();
  const result = await service.authorise({
    supervisedSendGateRecordId: 'gate-1', actorType: 'founder', actorId: 'human_executive', humanExecutionConfirmed: true,
  });
  assert.equal(result.execution.status, 'authorised_for_manual_execution');
  assert.equal(result.execution.sendAuthorised, true);
  assert.equal(result.execution.dispatchAuthorised, false);
  assert.equal(result.execution.pricingAuthorised, false);
  assert.equal(result.execution.commercialCommitmentAuthorised, false);
  assert.equal(result.record.eventType, 'sales_supervised_send_gate_recorded');
  assert.equal(created.length, 1);
});

test('rejects missing explicit human confirmation', async () => {
  const { service } = harness();
  await assert.rejects(() => service.authorise({ supervisedSendGateRecordId: 'gate-1', actorType: 'founder', actorId: 'human_executive', humanExecutionConfirmed: false }), /Explicit human execution confirmation/);
});

test('rejects non-Human Executive actor', async () => {
  const { service } = harness();
  await assert.rejects(() => service.authorise({ supervisedSendGateRecordId: 'gate-1', actorType: 'agent', actorId: 'sales_agent', humanExecutionConfirmed: true }), /Human Executive actor/);
});

test('rejects forged or incomplete supervised send gate authority', async () => {
  const events = fixtures();
  const gate = events.get('gate-1')!;
  events.set('gate-1', { ...gate, payload: { ...(gate.payload as object), sendAuthorised: true } });
  const { service, created } = harness(events);
  await assert.rejects(() => service.authorise({ supervisedSendGateRecordId: 'gate-1', actorType: 'founder', actorId: 'human_executive', humanExecutionConfirmed: true }), /not valid for explicit human execution/);
  assert.equal(created.length, 0);
});

test('rejects preparation with forged consequential authority', async () => {
  const events = fixtures();
  const preparation = events.get('preparation-1')!;
  events.set('preparation-1', { ...preparation, payload: { ...(preparation.payload as object), pricingAuthorised: true } });
  const { service, created } = harness(events);
  await assert.rejects(() => service.authorise({ supervisedSendGateRecordId: 'gate-1', actorType: 'founder', actorId: 'human_executive', humanExecutionConfirmed: true }), /invalid authority state/);
  assert.equal(created.length, 0);
});

test('rejects duplicate human execution authority', async () => {
  const { service } = harness();
  await service.authorise({ supervisedSendGateRecordId: 'gate-1', actorType: 'founder', actorId: 'human_executive', humanExecutionConfirmed: true });
  await assert.rejects(() => service.authorise({ supervisedSendGateRecordId: 'gate-1', actorType: 'founder', actorId: 'human_executive', humanExecutionConfirmed: true }), /already been recorded/);
});
