import type { Database } from '../database.js';

export interface PilotLeadWorkerQueryStore {
  get(): Promise<Record<string, { exhausted: boolean; lastAttemptedAt?: string }>>;
  save(state: Record<string, { exhausted: boolean; lastAttemptedAt: string }>): Promise<void>;
}

/**
 * PostgreSQL-backed query state store for the pilot lead worker.
 *
 * Uses a simple key-value table pattern. Create this table in your migrations:
 *
 * CREATE TABLE pilot_lead_worker_query_state (
 *   id SERIAL PRIMARY KEY,
 *   state_key TEXT NOT NULL DEFAULT 'default',
 *   query_state JSONB NOT NULL DEFAULT '{}',
 *   updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 *   UNIQUE(state_key)
 * );
 */
export function createPilotLeadWorkerQueryPostgresStore(
  db: Database,
  stateKey: string = 'default',
): PilotLeadWorkerQueryStore {
  return {
    async get(): Promise<Record<string, { exhausted: boolean; lastAttemptedAt?: string }>> {
      const result = await db.query<{ query_state: unknown }>(
        `SELECT query_state FROM pilot_lead_worker_query_state WHERE state_key = $1`,
        [stateKey],
      );
      const queryState = result.rows[0]?.query_state;
      if (!queryState) return {};
      return queryState as Record<string, { exhausted: boolean; lastAttemptedAt?: string }>;
    },

    async save(state: Record<string, { exhausted: boolean; lastAttemptedAt: string }>): Promise<void> {
      await db.query(
        `INSERT INTO pilot_lead_worker_query_state (state_key, query_state, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (state_key)
         DO UPDATE SET query_state = EXCLUDED.query_state, updated_at = NOW()`,
        [stateKey, JSON.stringify(state)],
      );
    },
  };
}

// In-memory fallback for testing
export function createPilotLeadWorkerQueryMemoryStore(
  initial: Record<string, { exhausted: boolean; lastAttemptedAt?: string }> = {},
): PilotLeadWorkerQueryStore {
  let state = { ...initial };
  return {
    async get() {
      return { ...state };
    },
    async save(newState) {
      state = { ...newState };
    },
  };
}
