import type { Pool } from 'pg';

export interface SalesOutreachSuppressionInput {
  leadId: string;
  recipientAddress: string;
  reason: 'explicit_opt_out';
  sourceInboundEvidenceId: string;
  sourceProviderMessageId: string;
}

export interface SalesOutreachSuppressionRecord extends SalesOutreachSuppressionInput {
  active: true;
  suppressedAt: string;
}

type Row = {
  lead_id: string;
  recipient_address: string;
  reason: 'explicit_opt_out';
  source_inbound_evidence_id: string;
  source_provider_message_id: string;
  active: boolean;
  suppressed_at: string | Date;
};

function required(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} is required.`);
  return normalized;
}

function map(row: Row): SalesOutreachSuppressionRecord {
  if (!row.active) throw new Error('Recorded Sales outreach suppression must be active.');
  return {
    leadId: row.lead_id,
    recipientAddress: row.recipient_address,
    reason: row.reason,
    sourceInboundEvidenceId: row.source_inbound_evidence_id,
    sourceProviderMessageId: row.source_provider_message_id,
    active: true,
    suppressedAt: row.suppressed_at instanceof Date
      ? row.suppressed_at.toISOString()
      : new Date(row.suppressed_at).toISOString(),
  };
}

export class SalesOutreachSuppressionConflictError extends Error {
  constructor(readonly recipientAddress: string, readonly sourceProviderMessageId: string) {
    super(`Active Sales outreach suppression already exists for ${recipientAddress} or provider message ${sourceProviderMessageId}.`);
    this.name = 'SalesOutreachSuppressionConflictError';
  }
}

export class SalesOutreachSuppressionPostgresStore {
  constructor(private readonly pool: Pick<Pool, 'query'>) {}

  async record(input: SalesOutreachSuppressionInput): Promise<SalesOutreachSuppressionRecord> {
    const leadId = required(input.leadId, 'leadId');
    const recipientAddress = required(input.recipientAddress, 'recipientAddress').toLowerCase();
    const sourceInboundEvidenceId = required(input.sourceInboundEvidenceId, 'sourceInboundEvidenceId');
    const sourceProviderMessageId = required(input.sourceProviderMessageId, 'sourceProviderMessageId');

    const result = await this.pool.query<Row>(
      `insert into operational.sales_outreach_suppressions
         (lead_id, recipient_address, reason, source_inbound_evidence_id, source_provider_message_id)
       values ($1,$2,$3,$4,$5)
       on conflict do nothing
       returning lead_id, recipient_address, reason, source_inbound_evidence_id,
                 source_provider_message_id, active, suppressed_at`,
      [leadId, recipientAddress, input.reason, sourceInboundEvidenceId, sourceProviderMessageId],
    );

    if (!result.rows[0]) {
      throw new SalesOutreachSuppressionConflictError(recipientAddress, sourceProviderMessageId);
    }
    return map(result.rows[0]);
  }

  async isActiveForRecipient(recipientAddress: string): Promise<boolean> {
    const normalized = required(recipientAddress, 'recipientAddress').toLowerCase();
    const result = await this.pool.query<{ exists: boolean }>(
      `select exists (
         select 1
         from operational.sales_outreach_suppressions
         where lower(recipient_address) = $1
           and active = true
       ) as exists`,
      [normalized],
    );
    return result.rows[0]?.exists === true;
  }
}
