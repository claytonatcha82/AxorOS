import { describe, expect, it, vi } from 'vitest';
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

describe('SalesInboundReplyClassificationPostgresStore', () => {
  it('persists and maps the governed classification without granting authority', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [{
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
      }],
    });
    const store = new SalesInboundReplyClassificationPostgresStore({ query } as never);

    const saved = await store.record(classification());

    expect(saved).toMatchObject({
      providerMessageId: 'gmail-message-1',
      primaryCategory: 'positive_interest',
      classificationSource: 'model_assisted',
      responseAuthorised: false,
      pricingAuthorised: false,
      discountAuthorised: false,
      commercialCommitmentAuthorised: false,
      contractAuthorised: false,
      humanReviewRequired: true,
    });
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, values] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('on conflict do nothing');
    expect(sql).toContain('false,false,false,false,false');
    expect(values).toContain('gmail-message-1');
  });

  it('fails closed when the same evidence or provider message conflicts', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const store = new SalesInboundReplyClassificationPostgresStore({ query } as never);

    await expect(store.record(classification())).rejects.toEqual(
      new SalesInboundReplyClassificationConflictError('gmail-message-1'),
    );
  });
});
