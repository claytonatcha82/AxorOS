import type { SalesInboundReplyEvidencePostgresStore } from '../data/sales-inbound-reply-evidence-postgres-store.js';
import type { SalesInboundReplyDetectionService } from './sales-inbound-reply-detection-service.js';

export interface SalesInboundReplyEvidenceResult {
  outboundRecordId: string;
  leadId: string;
  replyDetected: boolean;
  evidenceRecorded: boolean;
  providerMessageId?: string;
  automaticResponseAuthorised: false;
  nextAction: 'await_external_reply' | 'classify_persisted_inbound_reply';
}

export function createSalesInboundReplyEvidenceService(
  detector: Pick<SalesInboundReplyDetectionService, 'detect'>,
  evidenceStore: Pick<SalesInboundReplyEvidencePostgresStore, 'record'>,
) {
  return {
    async inspect(outboundRecordId: string): Promise<SalesInboundReplyEvidenceResult> {
      const detection = await detector.detect(outboundRecordId);
      if (!detection.replyDetected || !detection.reply) {
        return {
          outboundRecordId: detection.outboundRecordId,
          leadId: detection.leadId,
          replyDetected: false,
          evidenceRecorded: false,
          automaticResponseAuthorised: false,
          nextAction: 'await_external_reply',
        };
      }

      const reply = detection.reply;
      await evidenceStore.record({
        outboundRecordId: detection.outboundRecordId,
        leadId: detection.leadId,
        providerThreadReference: detection.providerThreadReference,
        providerMessageId: reply.messageId,
        ...(reply.from ? { senderAddress: reply.from } : {}),
        ...(reply.to ? { recipientAddress: reply.to } : {}),
        ...(reply.subject ? { subject: reply.subject } : {}),
        ...(reply.internalDate ? { providerInternalDate: reply.internalDate } : {}),
        ...(reply.snippet ? { snippet: reply.snippet } : {}),
        ...(reply.textBody ? { textBody: reply.textBody } : {}),
      });

      return {
        outboundRecordId: detection.outboundRecordId,
        leadId: detection.leadId,
        replyDetected: true,
        evidenceRecorded: true,
        providerMessageId: reply.messageId,
        automaticResponseAuthorised: false,
        nextAction: 'classify_persisted_inbound_reply',
      };
    },
  };
}

export type SalesInboundReplyEvidenceService = ReturnType<typeof createSalesInboundReplyEvidenceService>;
