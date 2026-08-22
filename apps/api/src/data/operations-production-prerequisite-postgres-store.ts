import type { Pool, PoolClient } from 'pg';
import type { WorkflowEventRecord } from './operational-repository.js';

export interface PersistOperationsProductionPrerequisiteInput {
  eventType: string;
  commercialRecordReference: string;
  evidenceReference: string;
  observedAt: string;
}

export class OperationsProductionPrerequisiteIntegrityConflictError extends Error {
  constructor(evidenceReference: string) {
    super(`Operations prerequisite integrity conflict for evidence reference ${evidenceReference}.`);
    this.name = 'OperationsProductionPrerequisiteIntegrityConflictError';
  }
}

function parsePayload(value: unknown): Record<string, unknown> {
  const parsed = typeof value === 'string' ? JSON.parse(value) as unknown : value;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Persisted Operations prerequisite payload is invalid.');
  }
  return parsed as Record<string, unknown>;
}

function normalizeTimestamp(value: unknown): string {
  const parsed = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(parsed.getTime())) throw new Error('Persisted Operations prerequisite timestamp is invalid.');
  return parsed.toISOString();
}

function mapWorkflowEvent(row: Record<string, unknown>): WorkflowEventRecord {
  return {
    id: String(row.id),
    clientId: row.client_id === null ? null : String(row.client_id),
    projectId: row.project_id === null ? null : String(row.project_id),
    eventType: String(row.event_type),
    actorType: String(row.actor_type),
    actorId: row.actor_id === null ? null : String(row.actor_id),
    payload: row.payload,
    createdAt: normalizeTimestamp(row.created_at),
  };
}

function samePrerequisite(
  existing: WorkflowEventRecord,
  incoming: PersistOperationsProductionPrerequisiteInput,
): boolean {
  if (existing.eventType !== incoming.eventType) return false;
  if (existing.actorType !== 'agent' || existing.actorId !== 'operations_agent') return false;

  const payload = parsePayload(existing.payload);
  return payload.commercialRecordReference === incoming.commercialRecordReference
    && payload.verified === true
    && payload.evidenceReference === incoming.evidenceReference
    && normalizeTimestamp(payload.observedAt) === normalizeTimestamp(incoming.observedAt);
}

async function selectByEvidenceReference(
  client: Pick<PoolClient, 'query'>,
  evidenceReference: string,
): Promise<WorkflowEventRecord | null> {
  const result = await client.query(
    `select id, client_id, project_id, event_type, actor_type, actor_id, payload, created_at
       from operational.workflow_events
      where actor_type = 'agent'
        and actor_id = 'operations_agent'
        and payload ->> 'evidenceReference' = $1
      order by created_at asc, id asc
      limit 1`,
    [evidenceReference],
  );
  const row = result.rows[0] as Record<string, unknown> | undefined;
  return row ? mapWorkflowEvent(row) : null;
}

export class OperationsProductionPrerequisitePostgresStore {
  constructor(private readonly pool: Pick<Pool, 'connect'>) {}

  async record(input: PersistOperationsProductionPrerequisiteInput): Promise<WorkflowEventRecord> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query(
        'select pg_advisory_xact_lock(hashtextextended($1, 0))',
        [`operations-production-prerequisite:${input.evidenceReference}`],
      );

      const existing = await selectByEvidenceReference(client, input.evidenceReference);
      if (existing) {
        if (!samePrerequisite(existing, input)) {
          throw new OperationsProductionPrerequisiteIntegrityConflictError(input.evidenceReference);
        }
        await client.query('commit');
        return existing;
      }

      const result = await client.query(
        `insert into operational.workflow_events
           (event_type, actor_type, actor_id, payload)
         values ($1, 'agent', 'operations_agent', $2::jsonb)
         returning id, client_id, project_id, event_type, actor_type, actor_id, payload, created_at`,
        [
          input.eventType,
          JSON.stringify({
            commercialRecordReference: input.commercialRecordReference,
            verified: true,
            evidenceReference: input.evidenceReference,
            observedAt: normalizeTimestamp(input.observedAt),
          }),
        ],
      );
      const row = result.rows[0] as Record<string, unknown> | undefined;
      if (!row) throw new Error('Operations prerequisite event insert returned no authoritative row.');

      await client.query('commit');
      return mapWorkflowEvent(row);
    } catch (error) {
      try {
        await client.query('rollback');
      } catch {
        // Preserve the original transaction failure.
      }
      throw error;
    } finally {
      client.release();
    }
  }
}
