import {
  createSalesInboundReplyClassificationRecord,
  type SalesInboundReplyClassificationRecord,
} from './sales-inbound-reply-classification-contract.js';
import { detectSalesInboundOptOut } from './sales-inbound-opt-out-detector.js';

export interface SalesInboundDeterministicClassificationInput {
  inboundEvidenceId: string;
  outboundRecordId: string;
  leadId: string;
  providerMessageId: string;
  textBody?: string;
  snippet?: string;
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
  const optOut = detectSalesInboundOptOut(combinedEvidenceText(input));

  if (!optOut.optOutDetected) {
    return { classificationApplied: false };
  }

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
