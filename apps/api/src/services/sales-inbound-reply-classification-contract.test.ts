import { describe, expect, it } from 'vitest';
import {
  createSalesInboundReplyClassificationRecord,
  SALES_INBOUND_REPLY_CATEGORIES,
} from './sales-inbound-reply-classification-contract.js';

describe('Sales inbound reply classification contract', () => {
  it('exposes only the Atlas-authorised inbound categories', () => {
    expect(SALES_INBOUND_REPLY_CATEGORIES).toEqual([
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

  it('creates an evidence-grounded classification with all consequential authorities false', () => {
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

    expect(record.responseAuthorised).toBe(false);
    expect(record.pricingAuthorised).toBe(false);
    expect(record.discountAuthorised).toBe(false);
    expect(record.commercialCommitmentAuthorised).toBe(false);
    expect(record.contractAuthorised).toBe(false);
    expect(record.humanReviewRequired).toBe(true);
  });

  it('rejects classifications without evidence reasons', () => {
    expect(() => createSalesInboundReplyClassificationRecord({
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
    })).toThrow('At least one evidence reason is required.');
  });

  it('rejects confidence values outside the classification range', () => {
    expect(() => createSalesInboundReplyClassificationRecord({
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
    })).toThrow('confidence must be a finite value between 0 and 1.');
  });
});
