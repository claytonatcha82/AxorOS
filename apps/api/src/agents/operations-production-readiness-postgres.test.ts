import assert from 'node:assert/strict';
import test from 'node:test';
import type { Pool } from 'pg';
import { createOperationsProductionReadinessPostgresService } from './operations-production-readiness-postgres.js';
import { OPERATIONS_PRODUCTION_PREREQUISITE_EVENT_TYPES } from './operations-production-prerequisite-evidence.js';

interface MemoryPoolOptions {
  missingPrerequisite?: keyof typeof OPERATIONS_PRODUCTION_PREREQUISITE_EVENT_TYPES;
}

function memoryPool(options: MemoryPoolOptions = {}): Pick<Pool, 'query'> {
  const rows = new Map<string, Record<string, unknown>>();
  return {
    query: (async (sql: string, values?: unknown[]) => {
      if (sql.includes('from operational.workflow_events')) {
        const commercialRecordReference = String(values?.[1]);
        const evidenceRows = Object.entries(OPERATIONS_PRODUCTION_PREREQUISITE_EVENT_TYPES)
          .filter(([key]) => key !== options.missingPrerequisite)
          .map(([key, eventType], index) => ({
            id: `workflow-${key}-${index + 1}`,
            event_type: eventType,
            actor_type: 'agent',
            actor_id: 'operations_agent',
            payload: {
              commercialRecordReference,
              verified: true,
            },
          }));
        return { rowCount: evidenceRows.length, rows: evidenceRows };
      }
      if (sql.includes('insert into operations.production_readiness_decisions')) {
        const readinessId = String(values?.[0]);
        if (rows.has(readinessId)) return { rowCount: 0, rows: [] };
        rows.set(readinessId, {
          readiness_id: values?.[0],
          commercial_record_reference: values?.[1],
          state: values?.[2],
          contract_signed: values?.[3],
          onboarding_complete: values?.[4],
          assets_available: values?.[5],
          planning_complete: values?.[6],
          evidence_references: JSON.parse(String(values?.[7])),
          approved_by: values?.[8],
          approved_at: new Date(String(values?.[9])),
        });
        return { rowCount: 1, rows: [] };
      }
      if (sql.includes('from operations.production_readiness_decisions')) {
        const row = rows.get(String(values?.[0]));
        return { rowCount: row ? 1 : 0, rows: row ? [row] : [] };
      }
      throw new Error(`Unexpected SQL in Operations readiness service test: ${sql}`);
    }) as Pool['query'],
  };
}

const completeAssessment = {
  readinessId: 'operations-readiness:service:1',
  commercialRecordReference: 'commercial:service:1',
  assessedAt: '2026-08-22T10:40:00.000Z',
};

test('PostgreSQL Operations readiness service persists and reloads OPERATIONS_READY authority from persisted prerequisite evidence', async () => {
  const service = createOperationsProductionReadinessPostgresService({ pool: memoryPool() });
  const result = await service.assess(completeAssessment);
  assert.equal(result.persistence, 'accepted');
  assert.equal(result.decision.state, 'OPERATIONS_READY');
  assert.equal(result.decision.approvedBy, 'operations_agent');
  assert.equal(result.decision.contractSigned, true);
  assert.equal(result.decision.onboardingComplete, true);
  assert.equal(result.decision.assetsAvailable, true);
  assert.equal(result.decision.planningComplete, true);
  assert.equal(result.decision.evidenceReferences.length, 4);
  assert.ok(result.decision.evidenceReferences.every((reference) => reference.startsWith('workflow-event:')));
});

test('PostgreSQL Operations readiness service persists missing authoritative prerequisite evidence as OPERATIONS_BLOCKED', async () => {
  const service = createOperationsProductionReadinessPostgresService({ pool: memoryPool({ missingPrerequisite: 'assetsAvailable' }) });
  const result = await service.assess({
    ...completeAssessment,
    readinessId: 'operations-readiness:service:blocked',
  });
  assert.equal(result.persistence, 'accepted');
  assert.equal(result.decision.state, 'OPERATIONS_BLOCKED');
  assert.equal(result.decision.assetsAvailable, false);
});

test('PostgreSQL Operations readiness service permits exact replay for the same identifier-only assessment', async () => {
  const service = createOperationsProductionReadinessPostgresService({ pool: memoryPool() });
  const first = await service.assess(completeAssessment);
  const replay = await service.assess(completeAssessment);
  assert.equal(first.persistence, 'accepted');
  assert.equal(replay.persistence, 'replayed');
  assert.deepEqual(replay.decision, first.decision);
});
