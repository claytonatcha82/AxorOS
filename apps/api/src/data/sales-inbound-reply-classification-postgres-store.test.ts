import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SalesInboundReplyClassificationConflictError,
  SalesInboundReplyClassificationPostgresStore,
} from './sales-inbound-reply-classification-postgres-store.js';
import { createSalesInboundReplyClassificationRecord } from '../services/sales-inbound-reply-classification-contract.js';

function classification() {
  return createSalesInboundReplyClassificationRecord({
    inboundEvidenceId: 'inbound-1',
    outboundRecordId: 'outbound-1',
    leadId: 'lead-1',
    providerMessageId: 'gmail-message-1',
    primaryCategory: 'positive_interest',
    evidenceReasons: [{ reason: 'Prospect asked to know more about the service.' }],
    deterministicSignals: {
      optOutDetected: false,
      automatedResponseDetected: false,
      deliveryFailureDetected: false,
    },
    commercialTopicDetected: false,
    sensitiveTopicDetected: false,
    uncertaintyDetected: false,
    classificationSource: 'model_assisted',
    modelReference: 'gemini-3.5-flash-lite',
    nextAction: 'prepare_sales_response',
    humanReviewRequired: true,
    classifiedAt: '2026-08-21T14:00:00.000Z',
  });
}

function row() {
  return {
    inbound_evidence_id: 'inbound-1',
    outbound_record_id: 'outbound-1',
    lead_id: 'lead-1',
    provider_message_id: 'gmail-message-1',
    primary_category: 'positive_interest',
    confidence: null,
    evidence_reasons: [{ reason: 'Prospect asked to know more about the service.' }],
    opt_out_detected: false,
    automated_response_detected: false,
    delivery_failure_detected: false,
    commercial_topic_detected: false,
    sensitive_topic_detected: false,
    uncertainty_detected: false,
    classification_source: 'model_assisted',
    model_reference: 'gemini-3.5-flash-lite',
    response_authorised: false,
    pricing_authorised: false,
    discount_authorised: false,
    commercial_commitment_authorised: false,
    contract_authorised: false,
    next_action: 'prepare_sales_response',
    human_review_required: true,
    classified_at: new Date('2026-08-21T14:00:00.000Z'),
  };
}

test('persists and maps the governed classification without granting authority', async () => {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const store = new SalesInboundReplyClassificationPostgresStore({
    async query(sql: string, params?: unknown[]) {
      calls.push({ sql, params: params ?? [] });
      return { rows: [row()], command: 'INSERT', rowCount: 1, oid: 0, fields: [] } as any;
    },
  } as any);

  const saved = await store.record(classification());

  assert.equal(saved.providerMessageId, 'gmail-message-1');
  assert.equal(saved.primaryCategory, 'positive_interest');
  assert.equal(saved.classificationSource, 'model_assisted');
  assert.equal(saved.responseAuthorised, false);
  assert.equal(saved.pricingAuthorised, false);
  assert.equal(saved.discountAuthorised, false);
  assert.equal(saved.commercialCommitmentAuthorised, false);
  assert.equal(saved.contractAuthorised, false);
  assert.equal(saved.humanReviewRequired, true);
  assert.equal(calls.length, 1);
  assert.match(calls[0]!.sql, /on conflict do nothing/i);
  assert.match(calls[0]!.sql, /false,false,false,false,false/i);
  assert.ok(calls[0]!.params.includes('gmail-message-1'));
});

test('fails closed when the same evidence or provider message conflicts', async () => {
  const store = new SalesInboundReplyClassificationPostgresStore({
    async query() {
      return { rows: [], command: 'INSERT', rowCount: 0, oid: 0, fields: [] } as any;
    },
  } as any);

  await assert.rejects(() => store.record(classification()), (error: unknown) => {
    assert.ok(error instanceof SalesInboundReplyClassificationConflictError);
    assert.equal(error.providerMessageId, 'gmail-message-1');
    return true;
  });
});
