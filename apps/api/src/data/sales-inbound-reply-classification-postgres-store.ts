import type { Pool } from 'pg';
import type {
  SalesInboundReplyCategory,
  SalesInboundReplyClassificationRecord,
  SalesInboundReplyClassificationSource,
  SalesInboundReplyNextAction,
} from '../services/sales-inbound-reply-classification-contract.js';

interface Row {
  inbound_evidence_id: string;
  outbound_record_id: string;
  lead_id: string;
  provider_message_id: string;
  primary_category: SalesInboundReplyCategory;
  confidence: number | null;
  evidence_reasons: Array<{ reason: string }>;
  opt_out_detected: boolean;
  automated_response_detected: boolean;
  delivery_failure_detected: boolean;
  commercial_topic_detected: boolean;
  sensitive_topic_detected: boolean;
  uncertainty_detected: boolean;
  classification_source: SalesInboundReplyClassificationSource;
  model_reference: string | null;
  response_authorised: false;
  pricing_authorised: false;
  discount_authorised: false;
  commercial_commitment_authorised: false;
  contract_authorised: false;
  next_action: SalesInboundReplyNextAction;
  human_review_required: boolean;
  classified_at: string | Date;
}

function iso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function map(row: Row): SalesInboundReplyClassificationRecord {
  return {
    inboundEvidenceId: row.inbound_evidence_id,
    outboundRecordId: row.outbound_record_id,
    leadId: row.lead_id,
    providerMessageId: row.provider_message_id,
    ...(row.confidence === null ? {} : { confidence: row.confidence }),
    primaryCategory: row.primary_category,
    evidenceReasons: row.evidence_reasons,
    deterministicSignals: {
      optOutDetected: row.opt_out_detected,
      automatedResponseDetected: row.automated_response_detected,
      deliveryFailureDetected: row.delivery_failure_detected,
    },
    commercialTopicDetected: row.commercial_topic_detected,
    sensitiveTopicDetected: row.sensitive_topic_detected,
    uncertaintyDetected: row.uncertainty_detected,
    classificationSource: row.classification_source,
    ...(row.model_reference === null ? {} : { modelReference: row.model_reference }),
    responseAuthorised: false,
    pricingAuthorised: false,
    discountAuthorised: false,
    commercialCommitmentAuthorised: false,
    contractAuthorised: false,
    nextAction: row.next_action,
    humanReviewRequired: row.human_review_required,
    classifiedAt: iso(row.classified_at),
  };
}

export class SalesInboundReplyClassificationConflictError extends Error {
  constructor(readonly providerMessageId: string) {
    super(`Sales inbound Gmail message ${providerMessageId} has already been classified.`);
    this.name = 'SalesInboundReplyClassificationConflictError';
  }
}

export class SalesInboundReplyClassificationPostgresStore {
  constructor(private readonly pool: Pick<Pool, 'query'>) {}

  async record(record: SalesInboundReplyClassificationRecord): Promise<SalesInboundReplyClassificationRecord> {
    const result = await this.pool.query<Row>(
      `insert into operational.sales_inbound_reply_classifications
         (inbound_evidence_id, outbound_record_id, lead_id, provider_message_id,
          primary_category, confidence, evidence_reasons,
          opt_out_detected, automated_response_detected, delivery_failure_detected,
          commercial_topic_detected, sensitive_topic_detected, uncertainty_detected,
          classification_source, model_reference,
          response_authorised, pricing_authorised, discount_authorised,
          commercial_commitment_authorised, contract_authorised,
          next_action, human_review_required, classified_at)
       values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12,$13,$14,$15,false,false,false,false,false,$16,$17,$18)
       on conflict do nothing
       returning inbound_evidence_id, outbound_record_id, lead_id, provider_message_id,
                 primary_category, confidence, evidence_reasons,
                 opt_out_detected, automated_response_detected, delivery_failure_detected,
                 commercial_topic_detected, sensitive_topic_detected, uncertainty_detected,
                 classification_source, model_reference,
                 response_authorised, pricing_authorised, discount_authorised,
                 commercial_commitment_authorised, contract_authorised,
                 next_action, human_review_required, classified_at`,
      [
        record.inboundEvidenceId,
        record.outboundRecordId,
        record.leadId,
        record.providerMessageId,
        record.primaryCategory,
        record.confidence ?? null,
        JSON.stringify(record.evidenceReasons),
        record.deterministicSignals.optOutDetected,
        record.deterministicSignals.automatedResponseDetected,
        record.deterministicSignals.deliveryFailureDetected,
        record.commercialTopicDetected,
        record.sensitiveTopicDetected,
        record.uncertaintyDetected,
        record.classificationSource,
        record.modelReference ?? null,
        record.nextAction,
        record.humanReviewRequired,
        record.classifiedAt,
      ],
    );

    if (!result.rows[0]) {
      throw new SalesInboundReplyClassificationConflictError(record.providerMessageId);
    }

    return map(result.rows[0]);
  }
}
