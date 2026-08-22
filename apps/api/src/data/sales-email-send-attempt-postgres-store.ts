import type { Pool } from 'pg';

export type SalesEmailSendAttemptStatus = 'reserved' | 'sent' | 'failed';

export interface SalesEmailSendAttempt {
  sendGateRecordId: string;
  draftRecordId: string;
  leadId: string;
  idempotencyKey: string;
  status: SalesEmailSendAttemptStatus;
  providerMessageId?: string;
  errorMessage?: string;
  reservedAt: string;
  completedAt?: string;
  updatedAt: string;
}

type PersistedSalesEmailSendAttempt = {
  send_gate_record_id: string;
  draft_record_id: string;
  lead_id: string;
  idempotency_key: string;
  status: SalesEmailSendAttemptStatus;
  provider_message_id: string | null;
  error_message: string | null;
  reserved_at: string | Date;
  completed_at: string | Date | null;
  updated_at: string | Date;
};

function normaliseTimestamp(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function rowToAttempt(row: PersistedSalesEmailSendAttempt): SalesEmailSendAttempt {
  return {
    sendGateRecordId: row.send_gate_record_id,
    draftRecordId: row.draft_record_id,
    leadId: row.lead_id,
    idempotencyKey: row.idempotency_key,
    status: row.status,
    ...(row.provider_message_id === null ? {} : { providerMessageId: row.provider_message_id }),
    ...(row.error_message === null ? {} : { errorMessage: row.error_message }),
    reservedAt: normaliseTimestamp(row.reserved_at),
    ...(row.completed_at === null ? {} : { completedAt: normaliseTimestamp(row.completed_at) }),
    updatedAt: normaliseTimestamp(row.updated_at),
  };
}

export class SalesEmailSendAttemptConflictError extends Error {
  constructor(readonly sendGateRecordId: string) {
    super(`Sales email send gate ${sendGateRecordId} already has a durable send attempt.`);
    this.name = 'SalesEmailSendAttemptConflictError';
  }
}

export class SalesEmailSendAttemptPostgresStore {
  constructor(private readonly pool: Pick<Pool, 'query'>) {}

  async getBySendGateRecordId(sendGateRecordId: string): Promise<SalesEmailSendAttempt | null> {
    const result = await this.pool.query<PersistedSalesEmailSendAttempt>(
      `select send_gate_record_id, draft_record_id, lead_id, idempotency_key, status,
              provider_message_id, error_message, reserved_at, completed_at, updated_at
         from operational.sales_email_send_attempts
        where send_gate_record_id = $1
        limit 1`,
      [sendGateRecordId],
    );
    return result.rows[0] ? rowToAttempt(result.rows[0]) : null;
  }

  async reserve(
    sendGateRecordId: string,
    draftRecordId: string,
    leadId: string,
    idempotencyKey: string,
  ): Promise<SalesEmailSendAttempt> {
    const result = await this.pool.query<PersistedSalesEmailSendAttempt>(
      `insert into operational.sales_email_send_attempts
         (send_gate_record_id, draft_record_id, lead_id, idempotency_key, status)
       values ($1, $2, $3, $4, 'reserved')
       on conflict do nothing
       returning send_gate_record_id, draft_record_id, lead_id, idempotency_key, status,
                 provider_message_id, error_message, reserved_at, completed_at, updated_at`,
      [sendGateRecordId, draftRecordId, leadId, idempotencyKey],
    );

    if (result.rows[0]) return rowToAttempt(result.rows[0]);
    throw new SalesEmailSendAttemptConflictError(sendGateRecordId);
  }

  async markSent(sendGateRecordId: string, providerMessageId: string): Promise<SalesEmailSendAttempt> {
    const result = await this.pool.query<PersistedSalesEmailSendAttempt>(
      `update operational.sales_email_send_attempts
          set status = 'sent', provider_message_id = $2, error_message = null,
              completed_at = now(), updated_at = now()
        where send_gate_record_id = $1 and status = 'reserved'
        returning send_gate_record_id, draft_record_id, lead_id, idempotency_key, status,
                  provider_message_id, error_message, reserved_at, completed_at, updated_at`,
      [sendGateRecordId, providerMessageId],
    );

    if (!result.rows[0]) throw new Error(`Sales email send attempt ${sendGateRecordId} is not reservable as sent.`);
    return rowToAttempt(result.rows[0]);
  }

  async markFailed(sendGateRecordId: string, errorMessage: string): Promise<SalesEmailSendAttempt> {
    const result = await this.pool.query<PersistedSalesEmailSendAttempt>(
      `update operational.sales_email_send_attempts
          set status = 'failed', error_message = $2, provider_message_id = null,
              completed_at = now(), updated_at = now()
        where send_gate_record_id = $1 and status = 'reserved'
        returning send_gate_record_id, draft_record_id, lead_id, idempotency_key, status,
                  provider_message_id, error_message, reserved_at, completed_at, updated_at`,
      [sendGateRecordId, errorMessage],
    );

    if (!result.rows[0]) throw new Error(`Sales email send attempt ${sendGateRecordId} is not reservable as failed.`);
    return rowToAttempt(result.rows[0]);
  }
}
