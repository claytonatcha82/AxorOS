import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSalesInboundReplyClassificationRecord,
  SALES_INBOUND_REPLY_CATEGORIES,
} from './sales-inbound-reply-classification-contract.js';

test('Sales inbound classification exposes only Atlas-authorised categories', () => {
  assert.deepEqual(SALES_INBOUND_REPLY_CATEGORIES, [
    'positive_interest',
    'information_request',
    'pricing_or_commercial_question',
    'meeting_request',
    'objection',
    'not_interested',
    'opt_out',
    'automated_response',
    'delivery_failure',
    'ambiguous',
    'sensitive_or_high_risk',
  ]);
});

test('Sales inbound classification keeps consequential authorities false', () => {
  const record = createSalesInboundReplyClassificationRecord({
    inboundEvidenceId: 'evidence-1',
    outboundRecordId: 'outbound-1',
    leadId: 'lead-1',
    providerMessageId: 'gmail-message-1',
    primaryCategory: 'positive_interest',
    confidence: 0.94,
    evidenceReasons: [{ reason: 'Sender explicitly asked to know more about the service.' }],
    deterministicSignals: {
      optOutDetected: false,
      automatedResponseDetected: false,
      deliveryFailureDetected: false,
    },
    commercialTopicDetected: false,
    sensitiveTopicDetected: false,
    uncertaintyDetected: false,
    classificationSource: 'model_assisted',
    modelReference: 'bounded-classifier-test',
    nextAction: 'prepare_sales_response',
    humanReviewRequired: true,
    classifiedAt: '2026-08-21T12:00:00.000Z',
  });

  assert.equal(record.responseAuthorised, false);
  assert.equal(record.pricingAuthorised, false);
  assert.equal(record.discountAuthorised, false);
  assert.equal(record.commercialCommitmentAuthorised, false);
  assert.equal(record.contractAuthorised, false);
  assert.equal(record.humanReviewRequired, true);
});

test('Sales inbound classification rejects records without evidence reasons', () => {
  assert.throws(() => createSalesInboundReplyClassificationRecord({
    inboundEvidenceId: 'evidence-1',
    outboundRecordId: 'outbound-1',
    leadId: 'lead-1',
    providerMessageId: 'gmail-message-1',
    primaryCategory: 'ambiguous',
    confidence: 0.4,
    evidenceReasons: [],
    deterministicSignals: {
      optOutDetected: false,
      automatedResponseDetected: false,
      deliveryFailureDetected: false,
    },
    commercialTopicDetected: false,
    sensitiveTopicDetected: false,
    uncertaintyDetected: true,
    classificationSource: 'model_assisted',
    nextAction: 'human_review_required',
    humanReviewRequired: true,
    classifiedAt: '2026-08-21T12:00:00.000Z',
  }), /At least one evidence reason is required/);
});

test('Sales inbound classification rejects confidence outside zero to one', () => {
  assert.throws(() => createSalesInboundReplyClassificationRecord({
    inboundEvidenceId: 'evidence-1',
    outboundRecordId: 'outbound-1',
    leadId: 'lead-1',
    providerMessageId: 'gmail-message-1',
    primaryCategory: 'ambiguous',
    confidence: 1.1,
    evidenceReasons: [{ reason: 'Classification is uncertain.' }],
    deterministicSignals: {
      optOutDetected: false,
      automatedResponseDetected: false,
      deliveryFailureDetected: false,
    },
    commercialTopicDetected: false,
    sensitiveTopicDetected: false,
    uncertaintyDetected: true,
    classificationSource: 'model_assisted',
    nextAction: 'human_review_required',
    humanReviewRequired: true,
    classifiedAt: '2026-08-21T12:00:00.000Z',
  }), /confidence must be a finite value between 0 and 1/);
});
