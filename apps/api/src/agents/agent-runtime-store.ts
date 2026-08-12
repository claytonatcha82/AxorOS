import type { AgentRuntimeExecutionRecord, AgentRuntimeEvent } from './agent-runtime-state.js';
import type { RuntimeIdempotencyRecord } from './agent-runtime-idempotency.js';

export interface AgentRuntimeStore {
  getExecution(executionId: string): Promise<AgentRuntimeExecutionRecord | null>;
  saveExecution(record: AgentRuntimeExecutionRecord, expectedVersion: number): Promise<void>;
  appendEvent(event: AgentRuntimeEvent): Promise<void>;
  listEvents(executionId: string): Promise<readonly AgentRuntimeEvent[]>;
  hasIdempotencyKey(idempotencyKey: string): Promise<boolean>;
  saveIdempotencyRecord(record: RuntimeIdempotencyRecord): Promise<void>;
}

export class RuntimeVersionConflictError extends Error {
  constructor(executionId: string) {
    super(`runtime execution version conflict for ${executionId}.`);
    this.name = 'RuntimeVersionConflictError';
  }
}
