import type { AgentRuntimeEvent } from './agent-runtime-state.js';

export interface RuntimeIdempotencyRecord {
  idempotencyKey: string;
  executionId: string;
  eventId: string;
  operation: string;
  firstSeenAt: string;
  completed: boolean;
}

export function runtimeIdempotencyKey(scope: string, executionId: string, operation: string): string {
  return `${scope}:${executionId}:${operation}`;
}

export function isDuplicateRuntimeEvent(event: AgentRuntimeEvent, seenKeys: ReadonlySet<string>): boolean {
  return seenKeys.has(event.idempotencyKey);
}

export function assertRuntimeEventIsReplaySafe(event: AgentRuntimeEvent, seenKeys: ReadonlySet<string>): void {
  if (isDuplicateRuntimeEvent(event, seenKeys)) {
    throw new Error(`duplicate runtime event blocked for idempotency key ${event.idempotencyKey}.`);
  }
}

export function recordRuntimeIdempotency(event: AgentRuntimeEvent, operation: string): RuntimeIdempotencyRecord {
  return {
    idempotencyKey: event.idempotencyKey,
    executionId: event.executionId,
    eventId: event.eventId,
    operation,
    firstSeenAt: event.occurredAt,
    completed: true,
  };
}
