import type { WorkflowEventRecord } from '../data/operational-repository.js';
import type { GmailThreadEvidence, GmailThreadMessageEvidence } from '../integrations/gmail-draft-integration.js';

export interface SalesGmailThreadReader {
  readThread(threadReference: string): Promise<GmailThreadEvidence>;
}

export interface SalesInboundReplyEvidence {
  outboundRecordId: string;
  leadId: string;
  providerThreadReference: string;
  outboundProviderMessageId: string;
  replyDetected: boolean;
  reply?: GmailThreadMessageEvidence;
  automaticResponseAuthorised: false;
  nextAction: 'await_external_reply' | 'persist_inbound_reply_evidence';
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required.`);
  return value.trim();
}

function payloadOf(record: WorkflowEventRecord): Record<string, unknown> {
  if (!record.payload || typeof record.payload !== 'object' || Array.isArray(record.payload)) {
    throw new Error('Sales supervised email sent payload is invalid.');
  }
  return record.payload as Record<string, unknown>;
}

function normalizeAddress(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  const angle = value.match(/<([^<>]+)>/);
  return (angle?.[1] ?? value).trim().toLowerCase();
}

function internalDate(value: string | undefined): bigint | undefined {
  if (!value?.trim() || !/^\d+$/.test(value.trim())) return undefined;
  return BigInt(value.trim());
}

export function createSalesInboundReplyDetectionService(
  repository: Pick<{ getWorkflowEventById(id: string): Promise<WorkflowEventRecord | null> }, 'getWorkflowEventById'>,
  threadReader: SalesGmailThreadReader,
) {
  return {
    async detect(outboundRecordId: string): Promise<SalesInboundReplyEvidence> {
      const normalizedRecordId = requiredString(outboundRecordId, 'outboundRecordId');
      const outboundRecord = await repository.getWorkflowEventById(normalizedRecordId);
      if (!outboundRecord) throw new Error(`Sales supervised email sent record ${normalizedRecordId} was not found.`);
      if (outboundRecord.eventType !== 'sales_supervised_email_sent') {
        throw new Error('Inbound reply detection requires a persisted supervised Sales email sent record.');
      }
      if (outboundRecord.actorType !== 'agent' || outboundRecord.actorId !== 'sales_agent') {
        throw new Error('Inbound reply detection requires Sales Agent outbound provenance.');
      }

      const outbound = payloadOf(outboundRecord);
      if (outbound.sendExecuted !== true || outbound.supervised !== true || outbound.humanSendApprovalVerified !== true) {
        throw new Error('Inbound reply detection requires a completed supervised Sales send.');
      }

      const leadId = requiredString(outbound.leadId, 'leadId');
      const recipientEmail = requiredString(outbound.recipientEmail, 'recipientEmail').toLowerCase();
      const providerMessageId = requiredString(outbound.providerMessageId, 'providerMessageId');
      const providerThreadReference = requiredString(outbound.providerThreadReference, 'providerThreadReference');
      const thread = await threadReader.readThread(providerThreadReference);
      if (thread.threadReference !== providerThreadReference) {
        throw new Error('Gmail thread reader returned a different thread reference.');
      }

      const originalIndex = thread.messages.findIndex((message) => message.messageId === providerMessageId);
      if (originalIndex < 0) throw new Error('Persisted outbound Gmail message is not present in its recorded thread.');
      const original = thread.messages[originalIndex]!;
      const originalTimestamp = internalDate(original.internalDate);

      const candidates = thread.messages
        .slice(originalIndex + 1)
        .filter((message) => message.messageId !== providerMessageId)
        .filter((message) => normalizeAddress(message.from) === recipientEmail)
        .filter((message) => {
          const timestamp = internalDate(message.internalDate);
          return originalTimestamp === undefined || timestamp === undefined || timestamp > originalTimestamp;
        });

      const reply = candidates.at(-1);
      return {
        outboundRecordId: outboundRecord.id,
        leadId,
        providerThreadReference,
        outboundProviderMessageId: providerMessageId,
        replyDetected: Boolean(reply),
        ...(reply ? { reply } : {}),
        automaticResponseAuthorised: false,
        nextAction: reply ? 'persist_inbound_reply_evidence' : 'await_external_reply',
      };
    },
  };
}

export type SalesInboundReplyDetectionService = ReturnType<typeof createSalesInboundReplyDetectionService>;
