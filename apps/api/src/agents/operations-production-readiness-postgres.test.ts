import assert from 'node:assert/strict';
import test from 'node:test';
import type { Pool } from 'pg';
import { createOperationsProductionReadinessPostgresService } from './operations-production-readiness-postgres.js';

function memoryPool(): Pick<Pool, 'query'> {
  const rows = new Map<string, Record<string, unknown>>();
  return {
    query: (async (sql: string, values?: unknown[]) => {
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
  contractSigned: true,
  onboardingComplete: true,
  assetsAvailable: true,
  planningComplete: true,
  evidenceReferences: ['contract:service:1', 'onboarding:service:1', 'assets:service:1', 'plan:service:1'],
  assessedAt: '2026-08-22T10:40:00.000Z',
};

test('PostgreSQL Operations readiness service persists and reloads OPERATIONS_READY authority', async () => {
  const service = createOperationsProductionReadinessPostgresService({ pool: memoryPool() });
  const result = await service.assess(completeAssessment);
  assert.equal(result.persistence, 'accepted');
  assert.equal(result.decision.state, 'OPERATIONS_READY');
  assert.equal(result.decision.approvedBy, 'operations_agent');
  assert.deepEqual(result.decision.evidenceReferences, completeAssessment.evidenceReferences);
});

test('PostgreSQL Operations readiness service persists incomplete prerequisites as OPERATIONS_BLOCKED', async () => {
  const service = createOperationsProductionReadinessPostgresService({ pool: memoryPool() });
  const result = await service.assess({
    ...completeAssessment,
    readinessId: 'operations-readiness:service:blocked',
    assetsAvailable: false,
  });
  assert.equal(result.persistence, 'accepted');
  assert.equal(result.decision.state, 'OPERATIONS_BLOCKED');
  assert.equal(result.decision.assetsAvailable, false);
});

test('PostgreSQL Operations readiness service permits exact replay but rejects changed evidence under the same readiness ID', async () => {
  const service = createOperationsProductionReadinessPostgresService({ pool: memoryPool() });
  const first = await service.assess(completeAssessment);
  const replay = await service.assess(completeAssessment);
  assert.equal(first.persistence, 'accepted');
  assert.equal(replay.persistence, 'replayed');

  await assert.rejects(
    () => service.assess({ ...completeAssessment, evidenceReferences: [...completeAssessment.evidenceReferences, 'extra:evidence'] }),
    /integrity conflict/,
  );
});
