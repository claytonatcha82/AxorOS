import type { Pool } from 'pg';

export interface SalesInboundReplyEvidenceInput {
  outboundRecordId: string;
  leadId: string;
  providerThreadReference: string;
  providerMessageId: string;
  senderAddress?: string;
  recipientAddress?: string;
  subject?: string;
  providerInternalDate?: string;
  snippet?: string;
  textBody?: string;
}

export interface SalesInboundReplyEvidenceRecord extends SalesInboundReplyEvidenceInput {
  inboundEvidenceId: string;
  recordedAt: string;
}

type Row = {
  id: string | number | bigint;
  outbound_record_id: string;
  lead_id: string;
  provider_thread_reference: string;
  provider_message_id: string;
  sender_address: string | null;
  recipient_address: string | null;
  subject: string | null;
  provider_internal_date: string | null;
  snippet: string | null;
  text_body: string | null;
  recorded_at: string | Date;
};

function optional(value: string | null, key: string): Record<string, string> {
  return value === null ? {} : { [key]: value };
}

function map(row: Row): SalesInboundReplyEvidenceRecord {
  return {
    inboundEvidenceId: String(row.id),
    outboundRecordId: row.outbound_record_id,
    leadId: row.lead_id,
    providerThreadReference: row.provider_thread_reference,
    providerMessageId: row.provider_message_id,
    ...optional(row.sender_address, 'senderAddress'),
    ...optional(row.recipient_address, 'recipientAddress'),
    ...optional(row.subject, 'subject'),
    ...optional(row.provider_internal_date, 'providerInternalDate'),
    ...optional(row.snippet, 'snippet'),
    ...optional(row.text_body, 'textBody'),
    recordedAt: row.recorded_at instanceof Date ? row.recorded_at.toISOString() : new Date(row.recorded_at).toISOString(),
  } as SalesInboundReplyEvidenceRecord;
}

export class SalesInboundReplyEvidenceConflictError extends Error {
  constructor(readonly providerMessageId: string) {
    super(`Sales inbound Gmail message ${providerMessageId} has already been recorded.`);
    this.name = 'SalesInboundReplyEvidenceConflictError';
  }
}

export class SalesInboundReplyEvidencePostgresStore {
  constructor(private readonly pool: Pick<Pool, 'query'>) {}

  async record(input: SalesInboundReplyEvidenceInput): Promise<SalesInboundReplyEvidenceRecord> {
    const result = await this.pool.query<Row>(
      `insert into operational.sales_inbound_reply_evidence
         (outbound_record_id, lead_id, provider_thread_reference, provider_message_id,
          sender_address, recipient_address, subject, provider_internal_date, snippet, text_body)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       on conflict do nothing
       returning id, outbound_record_id, lead_id, provider_thread_reference, provider_message_id,
                 sender_address, recipient_address, subject, provider_internal_date, snippet, text_body, recorded_at`,
      [input.outboundRecordId, input.leadId, input.providerThreadReference, input.providerMessageId,
       input.senderAddress ?? null, input.recipientAddress ?? null, input.subject ?? null,
       input.providerInternalDate ?? null, input.snippet ?? null, input.textBody ?? null],
    );
    if (!result.rows[0]) throw new SalesInboundReplyEvidenceConflictError(input.providerMessageId);
    return map(result.rows[0]);
  }
}
