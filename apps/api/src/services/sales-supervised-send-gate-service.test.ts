import assert from 'node:assert/strict';
import test from 'node:test';
import type { WorkflowEventRecord } from '../data/operational-repository.js';
import { createSalesSupervisedSendGateService } from './sales-supervised-send-gate-service.js';

const now = '2026-08-20T18:40:00.000Z';

function reviewRecord(overrides: Partial<Record<string, unknown>> = {}): WorkflowEventRecord {
  return {
    id: 'review-1', clientId: null, projectId: null,
    eventType: 'sales_outreach_draft_review_recorded', actorType: 'founder', actorId: 'human_executive',
    payload: {
      draftRecordId: 'draft-1', leadId: 'lead-1', draftKind: 'outreach', decision: 'approved', reviewer: 'human_executive',
      reviewComplete: true, responseAuthorised: false, outreachAuthorised: false, sendAuthorised: false,
      pricingAuthorised: false, discountAuthorised: false, commercialCommitmentAuthorised: false,
      contractAuthorised: false, nextAction: 'prepare_supervised_send_gate', ...overrides,
    }, createdAt: now,
  };
}

function inboundReviewRecord(overrides: Partial<Record<string, unknown>> = {}): WorkflowEventRecord {
  return {
    ...reviewRecord(),
    eventType: 'sales_inbound_response_draft_review_recorded',
    payload: {
      draftRecordId: 'inbound-draft-1', leadId: 'lead-1', draftKind: 'inbound_response', decision: 'approved', reviewer: 'human_executive',
      reviewComplete: true, responseAuthorised: false, outreachAuthorised: false, sendAuthorised: false,
      pricingAuthorised: false, discountAuthorised: false, commercialCommitmentAuthorised: false,
      contractAuthorised: false, nextAction: 'prepare_supervised_send_gate', ...overrides,
    },
  };
}

function draftRecord(id = 'draft-1', recipientEmail = 'owner@example.com'): WorkflowEventRecord {
  return {
    id, clientId: null, projectId: null,
    eventType: 'sales_internal_outreach_draft_recorded', actorType: 'agent', actorId: 'sales_agent',
    payload: { leadId: 'lead-1', recipientEmail }, createdAt: now,
  };
}

function harness(record = reviewRecord()) {
  const created: Array<Record<string, unknown>> = [];
  const service = createSalesSupervisedSendGateService({
    async getWorkflowEventById(id) { return id === record.id ? record : null; },
    async createWorkflowEvent(input) {
      created.push(input as unknown as Record<string, unknown>);
      return { id: 'send-gate-1', clientId: null, projectId: null, eventType: input.eventType, actorType: input.actorType, actorId: input.actorId ?? null, payload: input.payload ?? {}, createdAt: now };
    },
  });
  return { service, created };
}

test('human approval creates supervised send authority without pricing or commercial authority', async () => {
  const { service, created } = harness();
  const result = await service.decide('review-1', 'approved');
  assert.equal(result.gate.draftKind, 'outreach');
  assert.equal(result.gate.supervised, true);
  assert.equal(result.gate.sendAuthorised, true);
  assert.equal(result.gate.responseAuthorised, false);
  assert.equal(result.gate.outreachAuthorised, false);
  assert.equal(result.gate.pricingAuthorised, false);
  assert.equal(result.gate.discountAuthorised, false);
  assert.equal(result.gate.commercialCommitmentAuthorised, false);
  assert.equal(result.gate.contractAuthorised, false);
  assert.equal(result.gate.nextAction, 'execute_supervised_email_send');
  assert.equal(created.length, 1);
  assert.equal(created[0]?.eventType, 'sales_supervised_send_gate_recorded');
});

test('approved inbound response review can enter the existing supervised send gate', async () => {
  const { service, created } = harness(inboundReviewRecord());
  const result = await service.decide('review-1', 'approved');
  assert.equal(result.gate.draftKind, 'inbound_response');
  assert.equal(result.gate.sendAuthorised, true);
  assert.equal(result.gate.responseAuthorised, false);
  assert.equal(result.gate.outreachAuthorised, false);
  assert.equal(result.gate.pricingAuthorised, false);
  assert.equal(result.gate.discountAuthorised, false);
  assert.equal(result.gate.commercialCommitmentAuthorised, false);
  assert.equal(result.gate.contractAuthorised, false);
  assert.equal(result.gate.nextAction, 'execute_supervised_email_send');
  assert.equal(created.length, 1);
});

test('human rejection does not grant send authority', async () => {
  const { service } = harness();
  const result = await service.decide('review-1', 'rejected');
  assert.equal(result.gate.sendAuthorised, false);
  assert.equal(result.gate.nextAction, 'return_to_outreach_review');
});

test('human rejection of inbound response returns it to inbound response review', async () => {
  const { service } = harness(inboundReviewRecord());
  const result = await service.decide('review-1', 'rejected');
  assert.equal(result.gate.sendAuthorised, false);
  assert.equal(result.gate.nextAction, 'return_to_inbound_response_review');
});

test('refuses send approval when draft review was rejected', async () => {
  const { service, created } = harness(reviewRecord({ decision: 'rejected', nextAction: 'revise_internal_outreach_draft' }));
  await assert.rejects(() => service.decide('review-1', 'approved'), /requires an approved, completed draft review/i);
  assert.equal(created.length, 0);
});

test('refuses send approval when review carries forged send authority', async () => {
  const { service, created } = harness(reviewRecord({ sendAuthorised: true }));
  await assert.rejects(() => service.decide('review-1', 'approved'), /no inherited/i);
  assert.equal(created.length, 0);
});

test('refuses inbound send approval when review carries forged consequential authority', async () => {
  const { service, created } = harness(inboundReviewRecord({ discountAuthorised: true }));
  await assert.rejects(() => service.decide('review-1', 'approved'), /no inherited/i);
  assert.equal(created.length, 0);
});

test('active outreach suppression blocks human send approval before authority is recorded', async () => {
  const review = reviewRecord();
  const draft = draftRecord();
  const created: Array<Record<string, unknown>> = [];
  const suppressionChecks: string[] = [];
  const service = createSalesSupervisedSendGateService({
    async getWorkflowEventById(id) {
      if (id === review.id) return review;
      if (id === draft.id) return draft;
      return null;
    },
    async createWorkflowEvent(input) {
      created.push(input as unknown as Record<string, unknown>);
      return { id: 'send-gate-1', clientId: null, projectId: null, eventType: input.eventType, actorType: input.actorType, actorId: input.actorId ?? null, payload: input.payload ?? {}, createdAt: now };
    },
  }, {
    async isActiveForRecipient(recipientAddress) {
      suppressionChecks.push(recipientAddress);
      return true;
    },
  });

  await assert.rejects(
    () => service.decide('review-1', 'approved'),
    /blocked by active outreach suppression for owner@example\.com/i,
  );
  assert.deepEqual(suppressionChecks, ['owner@example.com']);
  assert.equal(created.length, 0);
});
