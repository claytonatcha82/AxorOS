import {
  createSalesInboundReplyClassificationRecord,
  type SalesInboundReplyClassificationRecord,
} from './sales-inbound-reply-classification-contract.js';
import { detectSalesInboundOptOut } from './sales-inbound-opt-out-detector.js';
import { detectSalesInboundAutomatedResponse } from './sales-inbound-automated-response-detector.js';
import {
  detectSalesInboundDeliveryFailure,
  type SalesInboundDeliveryFailureProvenance,
} from './sales-inbound-delivery-failure-detector.js';

export interface SalesInboundDeterministicClassificationInput {
  inboundEvidenceId: string;
  outboundRecordId: string;
  leadId: string;
  providerMessageId: string;
  textBody?: string;
  snippet?: string;
  deliveryFailureProvenance?: SalesInboundDeliveryFailureProvenance;
  classifiedAt: string;
}

export type SalesInboundDeterministicClassificationResult =
  | {
      classificationApplied: false;
      classification?: never;
    }
  | {
      classificationApplied: true;
      classification: SalesInboundReplyClassificationRecord;
    };

function combinedEvidenceText(input: SalesInboundDeterministicClassificationInput): string {
  return [input.textBody, input.snippet]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join('\n');
}

export function classifySalesInboundDeterministically(
  input: SalesInboundDeterministicClassificationInput,
): SalesInboundDeterministicClassificationResult {
  const evidenceText = combinedEvidenceText(input);
  const optOut = detectSalesInboundOptOut(evidenceText);

  if (optOut.optOutDetected) {
    return {
      classificationApplied: true,
      classification: createSalesInboundReplyClassificationRecord({
        inboundEvidenceId: input.inboundEvidenceId,
        outboundRecordId: input.outboundRecordId,
        leadId: input.leadId,
        providerMessageId: input.providerMessageId,
        primaryCategory: 'opt_out',
        evidenceReasons: [
          { reason: `Explicit opt-out phrase detected: ${optOut.matchedPhrase ?? 'matched deterministic rule'}` },
        ],
        deterministicSignals: {
          optOutDetected: true,
          automatedResponseDetected: false,
          deliveryFailureDetected: false,
        },
        commercialTopicDetected: false,
        sensitiveTopicDetected: false,
        uncertaintyDetected: false,
        classificationSource: 'deterministic',
        nextAction: 'record_suppression',
        humanReviewRequired: false,
        classifiedAt: input.classifiedAt,
      }),
    };
  }

  const automatedResponse = detectSalesInboundAutomatedResponse(evidenceText);
  if (automatedResponse.automatedResponseDetected) {
    return {
      classificationApplied: true,
      classification: createSalesInboundReplyClassificationRecord({
        inboundEvidenceId: input.inboundEvidenceId,
        outboundRecordId: input.outboundRecordId,
        leadId: input.leadId,
        providerMessageId: input.providerMessageId,
        primaryCategory: 'automated_response',
        evidenceReasons: [
          { reason: `Known automated-response signal detected: ${automatedResponse.matchedSignal ?? 'matched deterministic rule'}` },
        ],
        deterministicSignals: {
          optOutDetected: false,
          automatedResponseDetected: true,
          deliveryFailureDetected: false,
        },
        commercialTopicDetected: false,
        sensitiveTopicDetected: false,
        uncertaintyDetected: false,
        classificationSource: 'deterministic',
        nextAction: 'await_or_schedule_governed_evaluation',
        humanReviewRequired: false,
        classifiedAt: input.classifiedAt,
      }),
    };
  }

  const deliveryFailure = detectSalesInboundDeliveryFailure(
    evidenceText,
    input.deliveryFailureProvenance ?? 'message_content',
  );
  if (deliveryFailure.deliveryFailureDetected) {
    return {
      classificationApplied: true,
      classification: createSalesInboundReplyClassificationRecord({
        inboundEvidenceId: input.inboundEvidenceId,
        outboundRecordId: input.outboundRecordId,
        leadId: input.leadId,
        providerMessageId: input.providerMessageId,
        primaryCategory: 'delivery_failure',
        evidenceReasons: [
          { reason: `Provider/system delivery-failure signal detected: ${deliveryFailure.matchedSignal ?? 'matched deterministic rule'}` },
        ],
        deterministicSignals: {
          optOutDetected: false,
          automatedResponseDetected: false,
          deliveryFailureDetected: true,
        },
        commercialTopicDetected: false,
        sensitiveTopicDetected: false,
        uncertaintyDetected: false,
        classificationSource: 'deterministic',
        nextAction: 'verify_contact_data_or_escalate',
        humanReviewRequired: false,
        classifiedAt: input.classifiedAt,
      }),
    };
  }

  return { classificationApplied: false };
}
