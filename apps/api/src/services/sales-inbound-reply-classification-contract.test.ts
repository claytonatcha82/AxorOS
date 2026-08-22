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

test('Sales inbound classification does not invent a confidence scale', () => {
  const withoutConfidence = createSalesInboundReplyClassificationRecord({
    inboundEvidenceId: 'evidence-1',
    outboundRecordId: 'outbound-1',
    leadId: 'lead-1',
    providerMessageId: 'gmail-message-1',
    primaryCategory: 'ambiguous',
    evidenceReasons: [{ reason: 'Classification confidence policy is not defined by Atlas.' }],
    deterministicSignals: {
      optOutDetected: false,
      automatedResponseDetected: false,
      deliveryFailureDetected: false,
    },
    commercialTopicDetected: false,
    sensitiveTopicDetected: false,
    uncertaintyDetected: true,
    classificationSource: 'human',
    nextAction: 'human_review_required',
    humanReviewRequired: true,
    classifiedAt: '2026-08-21T12:00:00.000Z',
  });
  assert.equal(withoutConfidence.confidence, undefined);

  const unscaledConfidence = createSalesInboundReplyClassificationRecord({
    inboundEvidenceId: 'evidence-2',
    outboundRecordId: 'outbound-2',
    leadId: 'lead-2',
    providerMessageId: 'gmail-message-2',
    primaryCategory: 'ambiguous',
    confidence: 1.1,
    evidenceReasons: [{ reason: 'The contract preserves a finite confidence value without defining its scale.' }],
    deterministicSignals: {
      optOutDetected: false,
      automatedResponseDetected: false,
      deliveryFailureDetected: false,
    },
    commercialTopicDetected: false,
    sensitiveTopicDetected: false,
    uncertaintyDetected: true,
    classificationSource: 'human',
    nextAction: 'human_review_required',
    humanReviewRequired: true,
    classifiedAt: '2026-08-21T12:00:00.000Z',
  });
  assert.equal(unscaledConfidence.confidence, 1.1);

  assert.throws(() => createSalesInboundReplyClassificationRecord({
    inboundEvidenceId: 'evidence-3',
    outboundRecordId: 'outbound-3',
    leadId: 'lead-3',
    providerMessageId: 'gmail-message-3',
    primaryCategory: 'ambiguous',
    confidence: Number.NaN,
    evidenceReasons: [{ reason: 'Non-finite values are not valid persisted evidence.' }],
    deterministicSignals: {
      optOutDetected: false,
      automatedResponseDetected: false,
      deliveryFailureDetected: false,
    },
    commercialTopicDetected: false,
    sensitiveTopicDetected: false,
    uncertaintyDetected: true,
    classificationSource: 'human',
    nextAction: 'human_review_required',
    humanReviewRequired: true,
    classifiedAt: '2026-08-21T12:00:00.000Z',
  }), /confidence must be finite when supplied/);
});
